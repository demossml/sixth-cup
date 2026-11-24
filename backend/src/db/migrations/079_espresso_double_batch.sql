ALTER TABLE tech_cards
  ADD COLUMN portion_mode TEXT NOT NULL DEFAULT 'proportional'
  CHECK (portion_mode IN ('proportional', 'whole_batch'));

UPDATE tech_cards
   SET output_qty = 2,
       portion_mode = 'whole_batch',
       method_text = CASE
         WHEN instr(COALESCE(method_text, ''), 'Порция приготовления: 18 г кофе') > 0 THEN method_text
         ELSE trim(COALESCE(method_text || char(10), '') ||
           'Порция приготовления: 18 г кофе даёт 36 г эспрессо (2 шота). При использовании 1–2 шотов учитывается одна полная порция; 3–4 шота — две порции.')
       END,
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE kind = 'semi'
   AND lower(trim(name)) IN ('espresso', 'эспрессо')
   AND output_qty = 1
   AND output_unit = 'pcs'
   AND (SELECT COUNT(*) FROM tech_cards espresso
         WHERE espresso.kind = 'semi'
           AND lower(trim(espresso.name)) IN ('espresso', 'эспрессо')) = 1
   AND EXISTS (
     SELECT 1
       FROM tech_card_versions v
       JOIN tech_card_lines l ON l.version_id = v.id
       JOIN stock_items i ON i.id = l.stock_item_id
      WHERE v.card_id = tech_cards.id
        AND v.id = (
          SELECT active.id
            FROM tech_card_versions active
           WHERE active.card_id = tech_cards.id
             AND active.valid_from <= CAST(strftime('%s', 'now') AS INTEGER) * 1000
           ORDER BY active.valid_from DESC, active.id DESC
           LIMIT 1
        )
        AND lower(trim(i.name)) = 'кофе молотый'
        AND i.unit = 'g'
        AND l.qty_brutto = 18
        AND l.loss_cold_pct = 0
        AND l.loss_hot_pct = 0
        AND l.line_role = 'base'
        AND (SELECT COUNT(*) FROM tech_card_lines active_lines WHERE active_lines.version_id = v.id) = 1
   );

CREATE TEMP TABLE espresso_recipe_version_map (
  old_version_id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL,
  new_valid_from INTEGER NOT NULL,
  new_version_id INTEGER
);

INSERT INTO espresso_recipe_version_map (old_version_id, card_id, new_valid_from)
SELECT DISTINCT v.id, v.card_id, v.valid_from + 1
  FROM tech_card_versions v
  JOIN tech_cards c ON c.id = v.card_id
  JOIN tech_card_lines l ON l.version_id = v.id
  JOIN stock_items i ON i.id = l.stock_item_id
 WHERE c.id NOT IN (
         SELECT id FROM tech_cards
          WHERE kind = 'semi' AND lower(trim(name)) IN ('espresso', 'эспрессо')
       )
   AND lower(trim(i.name)) = 'кофе молотый'
   AND i.unit = 'g'
   AND EXISTS (
     SELECT 1 FROM tech_cards espresso
      WHERE espresso.kind = 'semi'
        AND lower(trim(espresso.name)) IN ('espresso', 'эспрессо')
        AND espresso.portion_mode = 'whole_batch'
   )
   AND (SELECT COUNT(*) FROM tech_cards espresso_candidates
         WHERE espresso_candidates.kind = 'semi'
           AND lower(trim(espresso_candidates.name)) IN ('espresso', 'эспрессо')) = 1;

INSERT INTO tech_card_versions (card_id, valid_from, note, created_at)
SELECT card_id,
       new_valid_from,
       CASE
         WHEN trim(COALESCE((SELECT note FROM tech_card_versions WHERE id = old_version_id), '')) = ''
           THEN 'Кофе через заготовку Espresso'
         ELSE (SELECT note FROM tech_card_versions WHERE id = old_version_id) || ' · кофе через заготовку Espresso'
       END,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM espresso_recipe_version_map;

UPDATE espresso_recipe_version_map
   SET new_version_id = (
     SELECT v.id
       FROM tech_card_versions v
      WHERE v.card_id = espresso_recipe_version_map.card_id
        AND v.valid_from = espresso_recipe_version_map.new_valid_from
      ORDER BY v.id DESC
      LIMIT 1
   );

INSERT INTO tech_card_lines (
  version_id, sort_order, stock_item_id, child_card_id, qty_brutto,
  loss_cold_pct, loss_hot_pct, qty_netto, qty_yield, line_role
)
SELECT map.new_version_id,
       line.sort_order,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN NULL ELSE line.stock_item_id END,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN espresso.id ELSE line.child_card_id END,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN line.qty_brutto / 9.0 ELSE line.qty_brutto END,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN 0 ELSE line.loss_cold_pct END,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN 0 ELSE line.loss_hot_pct END,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN NULL ELSE line.qty_netto END,
       CASE WHEN lower(trim(item.name)) = 'кофе молотый' AND item.unit = 'g'
            THEN NULL ELSE line.qty_yield END,
       line.line_role
  FROM espresso_recipe_version_map map
  JOIN tech_card_lines line ON line.version_id = map.old_version_id
  LEFT JOIN stock_items item ON item.id = line.stock_item_id
  JOIN tech_cards espresso
    ON espresso.kind = 'semi'
   AND lower(trim(espresso.name)) IN ('espresso', 'эспрессо')
   AND espresso.portion_mode = 'whole_batch'
 WHERE map.new_version_id IS NOT NULL;

UPDATE tech_cards
   SET updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE id IN (SELECT card_id FROM espresso_recipe_version_map);

DROP TABLE espresso_recipe_version_map;
