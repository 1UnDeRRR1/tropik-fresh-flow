// Flat color emoji used in navigation. Renders the system's color emoji glyph
// (Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji) inside a sized box.
// Pass className to control box size + font-size (e.g. "h-9 w-9 text-[28px]").

import { cn } from "@/lib/utils";

export type FruitName =
  | "apple"
  | "grape"
  | "carrot"
  | "corn"
  | "lemon"
  | "orange"
  | "kiwi"
  | "strawberry"
  | "pineapple"
  | "eggplant"
  | "broccoli"
  | "watermelon"
  | "avocado"
  | "tomato"
  | "pepper"
  | "banana"
  | "cherry"
  | "leaf";

const EMOJI: Record<FruitName, string> = {
  apple: "🍎",
  grape: "🍇",
  carrot: "🥕",
  corn: "🌽",
  lemon: "🍋",
  orange: "🍊",
  kiwi: "🥝",
  strawberry: "🍓",
  pineapple: "🍍",
  eggplant: "🍆",
  broccoli: "🥦",
  watermelon: "🍉",
  avocado: "🥑",
  tomato: "🍅",
  pepper: "🌶️",
  banana: "🍌",
  cherry: "🍒",
  leaf: "🌿",
};

type Props = {
  name: FruitName;
  className?: string;
  "aria-hidden"?: boolean;
};

export function FruitIcon({ name, className, ...rest }: Props) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn("fruit-emoji inline-flex items-center justify-center leading-none select-none", className)}
      {...rest}
    >
      {EMOJI[name]}
    </span>
  );
}

export function labelToFruit(label: string): FruitName {
  switch (label) {
    case "Головна":
    case "Головна SA":
      return "apple";
    case "Поставки":
      return "grape";
    case "Логістика":
      return "carrot";
    case "Розподіл":
      return "corn";
    case "Вільно":
      return "lemon";
    case "Про. ЗЕД":
      return "orange";
    case "Календар":
      return "kiwi";
    case "Переказ":
      return "strawberry";
    case "Запропонувати":
      return "pineapple";
    case "Аналітика":
      return "banana";
    case "Статистика":
      return "broccoli";
    case "Master":
      return "tomato";
    case "Супер":
      return "watermelon";
    case "Архів":
      return "pepper";
    case "Профіль":
      return "avocado";
    default:
      return "leaf";
  }
}
