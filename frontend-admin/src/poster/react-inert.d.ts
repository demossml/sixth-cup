// React 18 не знает булев атрибут inert: true он молча не выводит. Пишем inert="" — атрибут
// попадает в DOM и работает (в React 19 это был бы inert={true}).
import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    inert?: "" | undefined;
  }
}
