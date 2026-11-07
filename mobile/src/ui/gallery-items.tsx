/**
 * The gallery's samples: the same content each component shows in public/design-system/live.html (stage data, 7 Nov 2026),
 * so the two can be compared pixel for pixel. Used only by app/dev/gallery.tsx.
 */
import { View } from "react-native";
import { AppHeader, BottomNav, BUYER_NAV, DashboardHero, DashboardTabs, DiwaliBanner, DiwaliLights } from "./chrome";
import { Badge, CartBubble, CategoryStrip, FilterChips, ItemCard, MenuHeader, PreorderBanner, SectionHead, SellerCard, SellerHero, TierRow, TimingStrip } from "./shop";
import { CATEGORY_PHOTOS } from "./photos";
import { AddressCard, Button, CartBar, EmptyState, ErrorState, Input, OTPInput, PermissionPrompt, PhoneInput, PreorderBannerHero, Progress, SheetHeader, Skeleton, SlotPicker, Spinner, StepBar, Toast } from "./atoms";
import { BillDetails, CheckoutCart, CheckoutFoot, DiwaliGiftCard, PrepPrefs, SuggestRail } from "./checkout";
import { BillSummary, BuyerOrderCard, InfoSection, Stepper, StatusHero } from "./orders";
import { EmailPrompt, MeSectionHead, OrderHistoryRow, ProfileHero, QuickTiles, SavedAddress } from "./account";
import { ListingCard, LocationBox, SellerOrderCard } from "./dashboard";
import { Text } from "./base";

const SB = "https://witoghpdfocywiosmrzv.supabase.co/storage/v1";
const NOMADIC = "bd8efaae-69e1-4dcb-bdcb-75d1874b96ed";
const img = (p: string, w: number) => `${SB}/render/image/public/fish-photos/${p}${p.includes("?") ? "&" : "?"}width=${w}&quality=70&resize=contain`;
const noop = () => {};
const Spacer = ({ h }: { h: number }) => <View style={{ height: h }} />;

export type GalleryItem = { id: string; rn: string; render: () => React.ReactElement };
export const GALLERY: GalleryItem[] = [
  { id: "AppHeader", rn: "AppHeader", render: () => <AppHeader area="Thane West" safeTop={false} still /> },
  { id: "PageHeader", rn: "AppHeader variant=page", render: () => <AppHeader variant="page" title="Your Orders" safeTop={false} still /> },
  { id: "DiwaliLights", rn: "DiwaliLights", render: () => <View style={{ height: 22, experimental_backgroundImage: "linear-gradient(135deg, #B3123B, #8B0A2E)" } as any}><DiwaliLights still /></View> },
  { id: "DiwaliBanner", rn: "DiwaliBanner", render: () => <DiwaliBanner /> },
  { id: "BottomNav", rn: "BottomNav", render: () => <BottomNav items={BUYER_NAV} active="home" safeBottom={false} /> },
  { id: "DashboardHero", rn: "DashboardHero", render: () => <DashboardHero shop="QA Test Seller" safeTop={false} /> },
  { id: "DashboardTabs", rn: "DashboardTabs", render: () => <DashboardTabs tabs={[{ key: "new", label: "New", count: 11 }, { key: "prog", label: "In Progress", count: 22 }, { key: "hist", label: "History", count: 166 }]} active="new" onTab={noop} search="" onSearch={noop} range="Last 30 days" type="All" onRange={noop} onType={noop} onCsv={noop} countText="11 pending" /> },
  { id: "PreorderBanner", rn: "PreorderBanner", render: () => <PreorderBanner icon="🔕" title="Notifications are off" text="Turn them on to get fresh listings and prices first" cta="How" /> },
  { id: "CategoryStrip", rn: "CategoryStrip", render: () => <CategoryStrip active="all" onPick={noop} items={[["all", "All Fish"], ["surmai", "Surmai"], ["prawns", "Prawns"], ["pomfret", "Pomfret"], ["crab", "Crab"], ["rawas", "Rawas"], ["bangda", "Bangda"]].map(([id, name]) => ({ id, name, photo: CATEGORY_PHOTOS[id] }))} /> },
  { id: "FilterChips", rn: "FilterChips", render: () => <FilterChips isActive={(k) => k === "all"} onPress={noop} chips={[{ key: "all", label: "All" }, { key: "open", label: "Open now" }, { key: "preorder", label: "Pre-order" }, "sep", { key: "pickup", label: "Pickup" }, { key: "delivery", label: "Delivery" }, "sep", { key: "top", label: "Top rated ★" }]} /> },
  { id: "SectionHead", rn: "SectionHead", render: () => <SectionHead title="Verified sellers near you" count={3} /> },
  { id: "SellerCard", rn: "SellerCard", render: () => <SellerCard name="Fishtokri" sub="Mumbai · 1.8 km" status="Pre-order · delivers today" statusColor="indigo" rating="5.0 ★" cover={`${SB}/object/public/fish-photos/sellers/fishtokri_banner.png`} chips={[{ photo: `${SB}/render/image/public/fish-photos/listings/2f39dfce-15c0-4f9a-a5b3-e95280479dbd/fishtokri-site-khapri-pomfret.png?width=700&quality=80&resize=contain`, name: "Pomfret (पापलेट)", price: "₹1220/pack" }]} more={12} delivery="Min ₹400" /> },
  { id: "SellerCardNoPhoto", rn: "SellerCard", render: () => <SellerCard name="QA Test Seller" sub="Thane · 1.8 km" status="Pre-order · next day" statusColor="indigo" rating="5.0 ★" hue="sky" chips={[{ photo: "https://nyavzumoljcrmmwcdcuj.supabase.co/storage/v1/object/public/fish-photos/listings/337904df-ef4d-4825-b3e6-7767bedf40d2/1792487561761.jpg", name: "Surmai (Kingfish) (सुरमई)", price: "₹1/pack" }]} more={2} delivery="Home delivery" /> },
  { id: "HomeCartPill", rn: "CartBubble home", render: () => <View style={{ paddingVertical: 12 }}><CartBubble home line="1 item · ₹549" thumbs={[`${SB}/object/public/fish-photos/sellers/${NOMADIC}/logo.jpg?v=1792481453664`]} /></View> },
  { id: "SellerHero", rn: "SellerHero", render: () => <SellerHero still cover={img(`sellers/${NOMADIC}/store.jpg?v=1792774300609`, 800)} logo={img(`sellers/${NOMADIC}/logo.jpg?v=1792481453664`, 320)} name="The Nomadic Catch" area="Thane" rating="5.0 ★" tags={["Pre-order available", "6km delivery"]} stats={[{ v: "6", l: "Items" }, { v: "Pre-order now", l: "for Sun 15 Nov", live: true }]} /> },
  { id: "TimingStrip", rn: "TimingStrip", render: () => <View style={{ paddingHorizontal: 16 }}><TimingStrip text="🌙 Pre-order anytime · delivered Sun & Wed · paused Sun & Wed 2 AM–1 PM" /></View> },
  { id: "MenuHeader", rn: "MenuHeader", render: () => <MenuHeader title="Pre-order Menu" count={6} /> },
  { id: "ItemCard", rn: "ItemCard + TierRow", render: () => (
    <ItemCard preorder photo={img(`listings/${NOMADIC}/1792434318889.png`, 300)} name="Prawns (कोळंबी)" size="500 g before cleaning · ~250 g after peeling · approx 20 pcs" desc="Fresh sea prawns, Sassoon Dock same morning · Never frozen · Peeled & deveined on request" limit="Max 4 packs per buyer/day">
      <TierRow tier={{ label: "½ kg (500g)", price: "₹499", was: "₹554", off: "10% OFF", best: true, count: 0 }} first onAdd={noop} onRemove={noop} />
      <TierRow tier={{ label: "1 kg", price: "₹999", was: "₹1,110", off: "10% OFF", count: 0 }} onAdd={noop} onRemove={noop} />
    </ItemCard>
  ) },
  { id: "ItemCardInCart", rn: "ItemCard (in cart)", render: () => (
    <ItemCard preorder popular photo={img(`listings/${NOMADIC}/1792432940278.png`, 300)} name="Surmai (Kingfish) (सुरमई)" size="500 g before cleaning · from large Surmai" desc="Sassoon Dock, bought same morning · Never frozen · Cleaned & cut your way (slices or steaks)" limit="Max 4 packs per buyer/day">
      <TierRow tier={{ label: "½ kg (500g)", price: "₹549", was: "₹610", off: "10% OFF", count: 1 }} first onAdd={noop} onRemove={noop} />
      <TierRow tier={{ label: "1 kg", price: "₹1098", was: "₹1,220", off: "10% OFF", count: 0 }} onAdd={noop} onRemove={noop} />
    </ItemCard>
  ) },
  { id: "CartBubble", rn: "CartBubble", render: () => <View style={{ paddingVertical: 12 }}><CartBubble line="1 item · ₹549" chip="🌙 Next delivery slot: Sun 15 Nov, 9–11 AM" chipColor="#7C3AED" thumbs={[img(`listings/${NOMADIC}/1792432940278.png`, 300)]} /></View> },
  { id: "SheetHeader", rn: "SheetHeader", render: () => <SheetHeader title="Checkout" handle={false} /> },
  { id: "StepBar", rn: "StepBar", render: () => <View style={{ paddingBottom: 16 }}><StepBar step={0} /></View> },
  { id: "CheckoutCart", rn: "CheckoutCart", render: () => <View style={{ paddingBottom: 12 }}><CheckoutCart when="Pre-order · Sun 15 Nov" shipment="Shipment of 1 item from The Nomadic Catch" items={[{ photo: img(`listings/${NOMADIC}/1792432940278.png`, 300), name: "Surmai (Kingfish) (सुरमई)", sub: "1 pack · ½ Kg", qty: 1, price: "₹549", was: "₹610" }]} /></View> },
  { id: "DiwaliGiftCard", rn: "DiwaliGiftCard", render: () => <View style={{ paddingBottom: 12 }}><DiwaliGiftCard /></View> },
  { id: "SuggestRail", rn: "SuggestRail", render: () => <View style={{ paddingBottom: 12 }}><SuggestRail items={[{ photo: img(`listings/${NOMADIC}/1792434318889.png`, 300), price: "₹499", was: "₹554", name: "Prawns (कोळंबी)", size: "½ kg" }, { photo: img(`listings/${NOMADIC}/1792433357586.png`, 300), price: "₹1,099", was: "₹1,221", name: "Pomfret (पापलेट)", size: "½ kg" }, { photo: img(`listings/${NOMADIC}/1792434873366.png`, 300), price: "₹259", was: "₹288", name: "Bombil (Bombay Duck) (बोंबील)", size: "½ kg" }, { photo: img(`listings/${NOMADIC}/1792436014060.png`, 300), price: "₹549", was: "₹610", name: "Halwa (Black Pomfret) (हलवा)", size: "½ kg" }]} /></View> },
  { id: "PrepPrefs", rn: "PrepPrefs", render: () => <View style={{ paddingBottom: 12 }}><PrepPrefs options={["🐟 Whole", "✂️ Cleaned", "🔪 Cut"]} note="" /></View> },
  { id: "BillDetails", rn: "BillDetails", render: () => <View style={{ paddingBottom: 12 }}><BillDetails rows={[{ k: "🧾 Items total", v: "₹549", was: "₹610", saved: "Saved ₹61" }, { k: "🛵 Delivery charge", v: "₹100", hint: "Shop for ₹450 more to get FREE delivery" }]} toPay="₹649" savings="₹61" /></View> },
  { id: "CheckoutFoot", rn: "CheckoutFoot", render: () => <CheckoutFoot to="Delivering to Home" address="101, QA Tower, QA, Majiwada, Thane" total="₹649" cta="Next: Delivery ›" /> },
  { id: "BuyerOrderCard", rn: "BuyerOrderCard", render: () => <View style={{ paddingBottom: 12 }}><BuyerOrderCard status="Cancelled" tone="red" seller="QA Test Seller" line="Order #465C5891 · 250 grams · Today" steps={[{ label: "Placed", state: "done" }, { label: "Cancelled", state: "fail" }]} /></View> },
  { id: "StatusHero", rn: "StatusHero", render: () => <View style={{ paddingBottom: 16 }}><StatusHero status="Cancelled" id="#465C5891" time="6/11/2026, 9:43:25 pm" tone="red" /></View> },
  { id: "OrderStepper", rn: "Stepper (InfoSection)", render: () => <View style={{ paddingBottom: 12 }}><InfoSection><Stepper size={26} labelSize={9} steps={[{ label: "Placed", state: "done" }, { label: "Cancelled", state: "fail" }]} failLine="#059669" /></InfoSection></View> },
  { id: "InfoSection", rn: "InfoSection", render: () => <View style={{ paddingBottom: 12 }}><InfoSection title="From"><Text style={{ fontSize: 14, fontWeight: "700" }}>QA Test Seller</Text><Text style={{ marginTop: 2, fontSize: 12 }}>Thane</Text></InfoSection></View> },
  { id: "BillSummary", rn: "BillSummary", render: () => <View style={{ paddingBottom: 12 }}><BillSummary rows={[{ k: "Subtotal", v: "₹200" }, { k: "Delivery", v: "₹13" }, { k: "Total", v: "₹213", strong: true, rule: true }, { k: "Final price", v: "₹180", rule: true }]} note="Pay on delivery · in the app, no cash" /></View> },
  { id: "ProfileHero", rn: "ProfileHero", render: () => <ProfileHero name="Welcome" phone="9876543210" /> },
  { id: "QuickTiles", rn: "QuickTiles", render: () => <View style={{ paddingTop: 36 }}><QuickTiles items={[{ icon: "qaPin", label: "Addresses" }, { icon: "qaOrders", label: "Orders" }, { icon: "qaBell", label: "Alerts" }, { icon: "qaPhone", label: "Call us" }]} /></View> },
  { id: "EmailPrompt", rn: "EmailPrompt", render: () => <View style={{ paddingBottom: 8 }}><EmailPrompt /></View> },
  { id: "MeSectionHead", rn: "MeSectionHead", render: () => <MeSectionHead title="Saved Addresses" /> },
  { id: "SavedAddress", rn: "SavedAddress", render: () => <View style={{ paddingBottom: 8 }}><SavedAddress label="Home" isDefault text="101, QA Tower, QA, Majiwada, Thane" /></View> },
  { id: "OrderHistoryRow", rn: "OrderHistoryRow", render: () => <View style={{ paddingBottom: 8 }}><OrderHistoryRow seller="QA Test Seller" line="Today · 0.25kg prawns" status="Cancelled" statusTone="red" total="₹200" /></View> },
  { id: "SellerOrderCard", rn: "SellerOrderCard", render: () => (
    <SellerOrderCard id="#F2904738 · 0001" time="15 Oct, 1:50 am" badges={[{ text: "Paid", tone: "paid" }, { text: "Paid, confirm", tone: "urgent" }]} itemsLine="2 items"
      lines={[{ text: "pomfret · 1 pack · Option", price: "₹810", badge: { text: "Paid, confirm", tone: "urgent" } }, { text: "surmai · 150 grams · Cut sluces medium and jumbo sizes", price: "₹1", badge: { text: "Cancelled", tone: "urgent" }, struck: true, refund: { title: "Refund pending: ₹1", text: "Refund processing via Razorpay — reaches the original payment method in 5–7 working days.", cta: "Retry refund" } }]}
      tags={[{ text: "Same day", kind: "order" }, { text: "Delivery", kind: "delivery" }]} location="Majiwada, Thane · ~1.4 km away" locationNote="(full address after you accept)" total="₹823" payment="Paid online · Razorpay · Ref" paymentRef="pay_S4_1792009211"
      next="Next: Confirm the order (or decline, the buyer is refunded in full)." paidLine="✅ Buyer paid ₹823, confirm to accept the order" actions={[{ title: "✓ Confirm order", kind: "primary" }, { title: "Can't fulfill", kind: "danger" }]} />
  ) },
  { id: "ListingCard", rn: "ListingCard", render: () => <ListingCard photo="https://nyavzumoljcrmmwcdcuj.supabase.co/storage/v1/object/public/fish-photos/listings/337904df-ef4d-4825-b3e6-7767bedf40d2/1792487561761.jpg" name="Surmai (Kingfish) (सुरमई)" note="500 g before cleaning · from large Surmai" price="₹1 / 150 g" live preorder chips={["499.7 kg in stock"]} upDisabled /> },
  { id: "FormField", rn: "Input", render: () => <View style={{ paddingHorizontal: 0 }}><Input label="Shop name" required placeholder="e.g. Sai Fish Centre" /></View> },
  { id: "LocationBox", rn: "LocationBox", render: () => <View style={{ paddingHorizontal: 16 }}><LocationBox set coords="Thane · 19.19064, 72.97918" /></View> },
  { id: "Button", rn: "Button", render: () => (
    <View style={{ padding: 16, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button title="Primary sm" size="sm" /><Button title="Primary md" /><Button title="Primary lg" size="lg" /><Button title="Secondary" variant="secondary" /><Button title="Ghost" variant="ghost" /><Button title="Danger" variant="danger" /><Button title="Disabled" disabled /><Button title="Loading" loading /><View style={{ width: "100%" }}><Button title="Full width" full /></View>
    </View>
  ) },
  { id: "Input", rn: "Input", render: () => (
    <View style={{ padding: 16, gap: 28 }}>
      <Input label="Business name" required value="QA Test Seller" /><Input label="Email" helper="We send order updates here" placeholder="you@example.com" /><Input label="Pincode" error="Enter a 6-digit pincode" value="4006" /><Input label="Email" success="Verified" value="owner@example.com" />
    </View>
  ) },
  { id: "PhoneInput", rn: "PhoneInput", render: () => <View style={{ padding: 16 }}><PhoneInput /></View> },
  { id: "OTPInput", rn: "OTPInput", render: () => <View style={{ padding: 16 }}><OTPInput value="" onChange={noop} autoFocus={false} helper="6-digit code sent via SMS · expires in 10 min" /></View> },
  { id: "Textarea", rn: "Input multiline", render: () => <View style={{ padding: 16 }}><Input label="Description" multiline helper="Shown under the fish name on your shop page." value="Sassoon Dock, bought same morning · Never frozen" /></View> },
  { id: "Spinner", rn: "Spinner", render: () => <View style={{ padding: 16, flexDirection: "row", gap: 16 }}><Spinner /><Spinner /><Spinner /><Spinner color="#059669" /></View> },
  { id: "Skeleton", rn: "Skeleton", render: () => <View style={{ padding: 16, gap: 10 }}><Skeleton height={120} radius={12} /><Skeleton width="70%" /><Skeleton width="40%" /><Skeleton width={48} height={48} radius={24} /></View> },
  { id: "Progress", rn: "Progress", render: () => <View style={{ padding: 16, gap: 10 }}><Progress value={30} /><Progress value={70} color="green" /><Progress value={90} color="orange" /></View> },
  { id: "SlotPicker", rn: "SlotPicker", render: () => <View style={{ padding: 16 }}><SlotPicker title="Sun 15 Nov" selected="b" onPick={noop} slots={[{ id: "a", time: "7–9 AM", label: "Morning" }, { id: "b", time: "9–11 AM", label: "Morning" }, { id: "c", time: "5–7 PM", label: "Evening", fee: 20 }, { id: "d", time: "7–9 PM", label: "Evening", disabled: true }]} /></View> },
  { id: "AddressCard", rn: "AddressCard", render: () => <View style={{ padding: 16, gap: 18 }}><AddressCard label="Home" type="home" text="101, QA Tower, Majiwada, Thane" isDefault selected /><AddressCard label="Office" type="office" text="Lodha Supremus, Wagle Estate, Thane" /></View> },
  { id: "EmptyState", rn: "EmptyState", render: () => <View style={{ paddingVertical: 16 }}><EmptyState icon="📋" title="No orders yet" desc="Browse verified sellers near you to get started." cta="Browse sellers" /></View> },
  { id: "ErrorState", rn: "ErrorState", render: () => <View style={{ paddingVertical: 16 }}><ErrorState icon="🌙" title="Seller just closed for the day" desc="You can pre-order for tomorrow or later, or pick a different seller." secondary="Other sellers" primary="Pre-order tomorrow" /></View> },
  { id: "PermissionPrompt", rn: "PermissionPrompt", render: () => <View style={{ paddingVertical: 16 }}><PermissionPrompt orange icon="🔔" title="Get notified about your fish" desc="We'll only ping you for things that matter." benefits={["Order confirmation by seller", "Pre-order morning updates", "Price drops on favorite species"]} allow="Enable notifications" skip="Maybe later" /></View> },
  { id: "CartBar", rn: "CartBar", render: () => <View style={{ paddingHorizontal: 16, paddingTop: 28, paddingBottom: 28, gap: 34 }}><CartBar line="2 items" total="₹1,048" cta="View cart →" /><CartBar line="Add ₹100 more for min order" total="₹300" cta="Keep shopping" tone="orange" /><CartBar line="🎉 Free delivery unlocked" total="₹1,600" cta="View cart →" tone="green" /><CartBar line="🌙 Pre-order for tomorrow" total="₹549" cta="Review →" tone="indigo" /></View> },
  { id: "PreorderBannerHero", rn: "PreorderBannerHero", render: () => <View style={{ paddingVertical: 16, gap: 10 }}><PreorderBannerHero /><PreorderBannerHero variant="empty" /></View> },
  { id: "Badge", rn: "Badge", render: () => (
    <View style={{ padding: 16, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Badge variant="rating" text="5.0 ★" /><Badge text="Pre-order available" /><Badge text="Open now · same day" color="green" /><Badge text="Pre-order · next day" color="indigo" /><Badge text="Cancelled" color="red" /><Badge text="Limited" color="orange" /><Badge variant="offer" text="10% OFF" /><Badge variant="status" text="New" /><Badge text="Small" /><Badge text="Large" />
    </View>
  ) },
  { id: "Toast", rn: "Toast", render: () => <View style={{ paddingVertical: 12 }}><Toast title="Added to cart" desc="Surmai · ½ kg · ₹549" /></View> },
];
void Spacer;
