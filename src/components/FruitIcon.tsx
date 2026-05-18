// Flat sticker-style fruit & vegetable icons used in navigation.
// All icons render at 24x24 viewBox. Pass className to control size.
// Active highlight is handled by parent (color). Tap animation is CSS.

import type { SVGProps } from "react";

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

type Props = SVGProps<SVGSVGElement> & { name: FruitName };

export function FruitIcon({ name, className, ...rest }: Props) {
  const common = {
    viewBox: "0 0 24 24",
    xmlns: "http://www.w3.org/2000/svg",
    className,
    ...rest,
  };
  switch (name) {
    case "apple":
      return (
        <svg {...common}>
          <path d="M7 7c1-2 4-2 5-1 1-1 4-1 5 1 2 2 1 6-1 9-1 1.5-2.5 2.5-4 2.5s-3-1-4-2.5C5 13 5 9 7 7Z" fill="#e53935" />
          <path d="M12 6c0-1.5 1-3 3-3" stroke="#5d4037" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M13 5.5c1-.5 2-.5 3 0" fill="#4caf50" />
        </svg>
      );
    case "grape":
      return (
        <svg {...common}>
          <path d="M11 4c1.5 0 3 .5 4 1.5" stroke="#5d4037" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M14 5.5c1.5-.5 3 0 3.5 1" fill="#4caf50" />
          {[
            [8, 9], [12, 9], [16, 9],
            [10, 12], [14, 12],
            [12, 15], [9, 15], [15, 15],
            [11, 18], [13, 18],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2" fill="#7b3fa0" />
          ))}
        </svg>
      );
    case "carrot":
      return (
        <svg {...common}>
          <path d="M9 21l-2-2 8-12 4 4-10 10Z" fill="#fb8c00" />
          <path d="M15 7c1-2 3-3 5-3-1 2-2 3-4 4" fill="#4caf50" />
          <path d="M13 5c0-2 1-3 3-3-1 2-1 3-2 4" fill="#43a047" />
        </svg>
      );
    case "corn":
      return (
        <svg {...common}>
          <path d="M12 3c3 0 5 3 5 8s-2 10-5 10-5-5-5-10 2-8 5-8Z" fill="#fdd835" />
          <g fill="#f9a825">
            <circle cx="10" cy="8" r=".8" /><circle cx="12" cy="8" r=".8" /><circle cx="14" cy="8" r=".8" />
            <circle cx="10" cy="11" r=".8" /><circle cx="12" cy="11" r=".8" /><circle cx="14" cy="11" r=".8" />
            <circle cx="10" cy="14" r=".8" /><circle cx="12" cy="14" r=".8" /><circle cx="14" cy="14" r=".8" />
            <circle cx="10" cy="17" r=".8" /><circle cx="12" cy="17" r=".8" /><circle cx="14" cy="17" r=".8" />
          </g>
          <path d="M7 6c2-2 5-3 5-3s-1 3-3 5-4 1-2-2Z" fill="#66bb6a" />
        </svg>
      );
    case "lemon":
      return (
        <svg {...common}>
          <path d="M5 13c0-5 4-9 9-9 3 0 5 2 5 5 0 5-4 9-9 9-3 0-5-2-5-5Z" fill="#fdd835" />
          <path d="M5 13c1 2 3 3 5 3" stroke="#f9a825" strokeWidth="1.2" fill="none" />
        </svg>
      );
    case "orange":
      return (
        <svg {...common}>
          <circle cx="12" cy="13" r="8" fill="#fb8c00" />
          <path d="M12 5v16M4 13h16M6 7l12 12M18 7L6 19" stroke="#ef6c00" strokeWidth=".8" opacity=".5" />
          <path d="M11 5c0-1 1-2 2-2" stroke="#5d4037" strokeWidth="1.2" fill="none" />
          <path d="M12 4c1-1 2-1 3 0" fill="#4caf50" />
        </svg>
      );
    case "kiwi":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="#8d6e63" />
          <circle cx="12" cy="12" r="7" fill="#aed581" />
          <circle cx="12" cy="12" r="2" fill="#fffde7" />
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const r = 5;
            const x = 12 + r * Math.cos((a * Math.PI) / 180);
            const y = 12 + r * Math.sin((a * Math.PI) / 180);
            return <circle key={a} cx={x} cy={y} r=".5" fill="#3e2723" />;
          })}
        </svg>
      );
    case "strawberry":
      return (
        <svg {...common}>
          <path d="M6 10c0-2 3-4 6-4s6 2 6 4c0 4-3 11-6 11s-6-7-6-11Z" fill="#e53935" />
          <g fill="#ffeb3b">
            <circle cx="9" cy="11" r=".5" /><circle cx="12" cy="12" r=".5" /><circle cx="15" cy="11" r=".5" />
            <circle cx="10" cy="14" r=".5" /><circle cx="14" cy="14" r=".5" /><circle cx="12" cy="16" r=".5" />
          </g>
          <path d="M7 7l2 1 1-2 2 2 2-2 1 2 2-1-2 3H9L7 7Z" fill="#4caf50" />
        </svg>
      );
    case "pineapple":
      return (
        <svg {...common}>
          <path d="M9 4l1 3 2-2 1 3 2-2 1 3" fill="none" stroke="#4caf50" strokeWidth="1.4" strokeLinejoin="round" />
          <ellipse cx="12" cy="14" rx="6" ry="8" fill="#fdd835" />
          <g stroke="#f57f17" strokeWidth=".8" fill="none">
            <path d="M7 11l5 3 5-3M7 14l5 3 5-3M7 17l5 3 5-3" />
          </g>
        </svg>
      );
    case "eggplant":
      return (
        <svg {...common}>
          <path d="M7 18c-2-2-2-6 0-8s6-3 9-1c2 1 2 4 0 6-2 3-7 5-9 3Z" fill="#7b3fa0" />
          <path d="M14 7c1-2 3-3 5-3-1 2-2 3-4 4" fill="#4caf50" />
        </svg>
      );
    case "broccoli":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" fill="#388e3c" />
          <circle cx="13" cy="7" r="3" fill="#43a047" />
          <circle cx="16" cy="10" r="3" fill="#388e3c" />
          <circle cx="11" cy="12" r="3" fill="#43a047" />
          <path d="M9 13l1 7h4l1-7" fill="#a5d6a7" />
        </svg>
      );
    case "watermelon":
      return (
        <svg {...common}>
          <path d="M3 20c4 2 14 2 18 0L12 4 3 20Z" fill="#388e3c" />
          <path d="M5 19c4 1.5 10 1.5 14 0L12 7 5 19Z" fill="#fdd835" />
          <path d="M6 18c3.5 1.4 9 1.4 12 0L12 9 6 18Z" fill="#e53935" />
          <g fill="#212121">
            <circle cx="10" cy="14" r=".5" /><circle cx="12" cy="15" r=".5" /><circle cx="14" cy="14" r=".5" />
            <circle cx="11" cy="17" r=".5" /><circle cx="13" cy="17" r=".5" />
          </g>
        </svg>
      );
    case "avocado":
      return (
        <svg {...common}>
          <path d="M8 6c0-2 2-3 4-3s4 1 4 3c0 1 2 3 2 7s-3 8-6 8-6-4-6-8 2-6 2-7Z" fill="#558b2f" />
          <ellipse cx="12" cy="14" rx="3" ry="4" fill="#dcedc8" />
          <circle cx="12" cy="14" r="1.6" fill="#6d4c41" />
        </svg>
      );
    case "tomato":
      return (
        <svg {...common}>
          <circle cx="12" cy="14" r="8" fill="#e53935" />
          <path d="M7 7l2 2 1-3 2 3 2-3 1 3 2-2-1 4H8L7 7Z" fill="#4caf50" />
        </svg>
      );
    case "pepper":
      return (
        <svg {...common}>
          <path d="M8 20c-3-2-3-7 0-10 2-2 5-3 8-3 0 4-1 8-3 11-2 2-3 3-5 2Z" fill="#e53935" />
          <path d="M14 7c0-2 1-4 3-4" stroke="#4caf50" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "banana":
      return (
        <svg {...common}>
          <path d="M4 14c2 6 9 8 14 5-1-4-3-7-6-9-3 1-6 2-8 4Z" fill="#fdd835" />
          <path d="M4 14c2 6 9 8 14 5" stroke="#f9a825" strokeWidth="1" fill="none" />
          <path d="M18 9l1-3" stroke="#5d4037" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "cherry":
      return (
        <svg {...common}>
          <path d="M8 5c2 2 4 5 5 9M16 5c-1 2-2 5-3 9" stroke="#5d4037" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <circle cx="8" cy="16" r="4" fill="#c62828" />
          <circle cx="15" cy="17" r="4" fill="#e53935" />
        </svg>
      );
    case "leaf":
      return (
        <svg {...common}>
          <path d="M5 19C5 10 12 4 20 4c0 8-6 15-15 15Z" fill="#43a047" />
          <path d="M5 19C9 14 14 10 19 6" stroke="#2e7d32" strokeWidth="1" fill="none" />
        </svg>
      );
  }
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
      return "eggplant";
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
