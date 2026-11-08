-- Откат 050: срок жизни кода регистрации и метка привязки ключа.
ALTER TABLE devices DROP COLUMN enroll_expires_at;
ALTER TABLE devices DROP COLUMN key_bound_at;
