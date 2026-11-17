
import { SendPanel } from "./SendPanel";

// Главная: список того, что пора печатать, и тут же отправка в типографию.
// Сколько документов ждёт — видно на бейдже вкладки и в заголовке блока отправки.

export function Home() {
  return (
    <div className="home">
      <header className="home-head">
        <h1 className="home-big">Список в печать</h1>
      </header>
      <SendPanel />
    </div>
  );
}
