import {
  Car,
  Landmark,
  Megaphone,
  ShieldCheck,
  Smartphone,
  SprayCan,
  Tag,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ExpenseCategory } from '@/lib/books/categories';

/** One icon per expense category, so a list of spending can be scanned by shape, not just by word. */
export const EXPENSE_CATEGORY_ICON: Record<ExpenseCategory, LucideIcon> = {
  vehicle: Car,
  equipment: Wrench,
  supplies: SprayCan,
  phone: Smartphone,
  insurance: ShieldCheck,
  advertising: Megaphone,
  fees: Landmark,
  wages: Users,
  other: Tag,
};
