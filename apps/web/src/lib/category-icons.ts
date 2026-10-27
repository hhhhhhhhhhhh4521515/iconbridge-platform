import {
  ConciergeBell,
  Factory,
  HardHat,
  Megaphone,
  Ship,
  Truck,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon names a category may carry (field `icon`), for the home page and the back office.
 * Any other value is shown as typed (an emoji, for example).
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'concierge-bell': ConciergeBell,
  'hard-hat': HardHat,
  wheat: Wheat,
  truck: Truck,
  factory: Factory,
  megaphone: Megaphone,
  ship: Ship,
};
