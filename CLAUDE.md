
## Order vs pre-order (source of truth)

- **Module:** `src/lib/order-timing.ts` — `classifyPlacementAtOrderTime()`, `isSellerEffectivelyOpen()`, `isPreorderShoppingWindow()`.
- **Resolver:** `src/lib/server/resolve-listing-order-line.ts` — used by `POST /api/orders/create` and `create-seller-cart`.
- **Persistence:** `orders.placement_kind` = `same_day` | `preorder` (migration `051_orders_placement_kind.sql`).
- **Not used for placement:** `is_preorder_enabled`, `scheduled_for`, OOS alone (OOS while open → 400; OOS while in pre-order window → pre-order line).
- **Emails:** `formatOrderQuantityEmailRows()` in `email-templates.ts` — packs, pieces, line total for bundles.
- **Buyer track list:** label is `Order` or `Pre-order` from `placement_kind`, not “Live”.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
