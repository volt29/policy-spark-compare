import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { SourceTooltip } from "@/components/comparison/SourceTooltip";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
