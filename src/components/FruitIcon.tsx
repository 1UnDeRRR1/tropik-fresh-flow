// Hand-drawn fruit illustrations used in navigation.
// Each name maps to an imported PNG asset. For names without a dedicated
// illustration we fall back to the closest visual match.

import { cn } from "@/lib/utils";

import apple from "@/assets/fruits/apple.png";
import appleGreen from "@/assets/fruits/apple-green.png";
import banana from "@/assets/fruits/banana.png";
import broccoli from "@/assets/fruits/broccoli.png";
import avocado from "@/assets/fruits/avocado.png";
import lemon from "@/assets/fruits/lemon.png";
import orange from "@/assets/fruits/orange.png";
import grape from "@/assets/fruits/grape.png";
import pear from "@/assets/fruits/pear.png";
import pomegranate from "@/assets/fruits/pomegranate.png";
import peach from "@/assets/fruits/peach.png";
import pineapple from "@/assets/fruits/pineapple.png";
import kiwi from "@/assets/fruits/kiwi.png";
import strawberry from "@/assets/fruits/strawberry.png";
import raspberry from "@/assets/fruits/raspberry.png";

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

const SRC: Record<FruitName, string> = {
  apple,
  grape,
  carrot: pear,
  corn: pomegranate,
  lemon,
  orange,
  kiwi,
  strawberry,
  pineapple,
  eggplant: pomegranate,
  broccoli,
  watermelon: peach,
  avocado,
  tomato: appleGreen,
  pepper: raspberry,
  banana,
  cherry: raspberry,
  leaf: broccoli,
};

type Props = {
  name: FruitName;
  className?: string;
  "aria-hidden"?: boolean;
};

export function FruitIcon({ name, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "fruit-emoji inline-flex items-center justify-center overflow-hidden leading-none select-none",
        className,
      )}
    >
      <img
        src={SRC[name]}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-full w-full object-contain"
      />
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
    case "Переміщення":
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
