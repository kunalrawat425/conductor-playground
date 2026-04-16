/**
 * V2 Component Type Definitions
 * Source of truth for all V2 component prop contracts.
 */

// === Shared ===
export type V2Color = 'brand' | 'green' | 'orange' | 'red' | 'indigo' | 'ink';
export type V2Size = 'sm' | 'md' | 'lg';
export type V2Tier = 'pickup' | 'delivery' | 'both';

// === Atoms ===
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: V2Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  iconLeft?: string;
  iconRight?: string;
  href?: string;
}

export interface BadgeProps {
  variant?: 'rating' | 'offer' | 'tag' | 'status';
  color?: V2Color;
  size?: V2Size;
}

export interface TagProps {
  color?: V2Color;
  closable?: boolean;
}

export interface InputProps {
  label?: string;
  helper?: string;
  error?: string;
  success?: string;
  required?: boolean;
  type?: string;
  prefix?: string;
}

export interface SpinnerProps {
  size?: V2Size;
  color?: V2Color;
}

export interface ToastProps {
  variant: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
  position?: 'top' | 'bottom';
}

// === Molecules ===
export interface SellerCardProps {
  id: string;
  name: string;
  location: string;
  distanceKm?: number;
  deliveryEtaMin?: number;
  rating: number;
  reviewCount?: number;
  status: 'open' | 'closed' | 'pre-order-only';
  acceptsPreorder: boolean;
  hasDelivery: boolean;
  deliveryFreeAbove?: number;
  deliveryRadiusKm?: number;
  itemCount: number;
  topItems: SellerCardItem[];
  imageHue?: 'sky' | 'green' | 'orange' | 'indigo';
  offerLabel?: string;
}

export interface SellerCardItem {
  emoji: string;
  name: string;
  price: number;
  unit: string;
}

export interface MenuItemProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  unit: string;
  emoji?: string;
  imageUrl?: string;
  badges?: string[];
  inCart?: number;
  isPreorder?: boolean;
  isSoldOut?: boolean;
  isLimited?: boolean;
  discount?: { from: number; pct: number };
}

export interface CartBarProps {
  items: number;
  total: number;
  minOrder?: number;
  freeDeliveryThreshold?: number;
  isPreorder?: boolean;
  href?: string;
}

export interface CategoryStripItem {
  id: string;
  name: string;
  emoji: string;
  active?: boolean;
}

export interface PreorderBannerProps {
  variant?: 'inline' | 'hero' | 'empty';
  title?: string;
  description?: string;
  ctaText?: string;
  href?: string;
}

export interface AddressCardProps {
  label: string;
  type: 'home' | 'office' | 'other';
  text: string;
  isDefault?: boolean;
  isSelected?: boolean;
  selectable?: boolean;
}

export interface EmptyStateProps {
  variant: 'no-area' | 'closed' | 'no-results' | 'no-orders' | 'cart-empty' | 'no-internet' | 'server-error';
  title?: string;
  description?: string;
  ctaText?: string;
  ctaHref?: string;
  ghostCtaText?: string;
  ghostCtaHref?: string;
}

// === Organisms ===
export interface AppHeaderProps {
  variant?: 'default' | 'preorder' | 'page';
  locationLabel?: string;
  locationSub?: string;
  showSearch?: boolean;
  showCart?: boolean;
  cartCount?: number;
  backHref?: string;
  title?: string;
}

export interface BottomNavProps {
  active: 'home' | 'search' | 'preorder' | 'orders' | 'account';
  ordersCount?: number;
  mode?: 'buyer' | 'seller';
}

export interface SellerHeroProps {
  name: string;
  location: string;
  distanceKm?: number;
  deliveryEtaMin?: number;
  rating: number;
  status: 'open' | 'closed';
  closesAt?: string;
  opensAt?: string;
  totalOrders?: number;
  itemCount?: number;
  catchTime?: string;
  tags?: string[];
}

export interface BottomSheetProps {
  title: string;
  open?: boolean;
  ctaText?: string;
  showHandle?: boolean;
}
