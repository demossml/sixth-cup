
import { Icon } from "./ui";

type Mail = { configured: boolean; from: string | null } | null;

const VARS: [string, string][] = [
  ["SMTP_HOST", "smtp.yandex.ru (Mail.ru — smtp.mail.ru, Gmail — smtp.gmail.com)"],
  ["SMTP_PORT", "465"],
  ["SMTP_USER", "полный адрес ящика"],
  ["SMTP_PASS", "пароль приложения из шага 1"],
  ["MAIL_FROM", "адрес отправителя, необязательно"],
];

/** Состояние почты на сервере и шаги, как её подключить. Стоит над блоком отправки. */
export function MailSetup({ mail }: { mail: Mail }) {
  const state = mail === null ? "wait" : mail.configured ? "on" : "off";
  const status =
    state === "wait" ? "Проверяем настройки сервера…" : state === "on" ? `Подключена, письма уходят с ${mail?.from}` : "Не подключена — пока можно только скачать архив";

  return (
    <section className={`mail ${state}`} aria-labelledby="mail-title">
      <h2 id="mail-title" className="mail-title">
        Почта для отправки
      </h2>
      <p className="mail-status" role="status">
        <span className="mail-dot" aria-hidden />
        <span>{status}</span>
      </p>
      <details className="mail-help">
        <summary>
          {state === "on" ? "Как сменить ящик" : "Как подключить почту"}
          <Icon name="chevron" size={16} />
        </summary>
        <ol className="mail-steps">
          <li>
            <b>Создайте пароль приложения</b> в ящике, с которого будут уходить письма, — основной пароль сервер не примет. В Яндексе: id.yandex.ru → Безопасность → Пароли
            приложений → Почта. В Mail.ru и Gmail — там же, в настройках безопасности.
          </li>
          <li>
            <b>Добавьте переменные окружения на сервер sixth-cup</b> (рядом с ADMIN_TOKEN и JWT_SECRET).
            <dl className="mail-vars">
              {VARS.map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <code>{k}</code>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </li>
          <li>
            <b>Перезапустите backend</b> — переменные читаются при запуске.
          </li>
          <li>
            <b>Обновите эту страницу</b> — статус сменится на «Подключена».
          </li>
        </ol>
        <p className="hint">Для локального запуска — те же переменные в окружении backend.</p>
      </details>
    </section>
  );
}
