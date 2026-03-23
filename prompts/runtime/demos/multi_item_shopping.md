---
id: demos.multi_item_shopping
version: v2
description: "Built-in demonstration for multi-item shopping: add multiple products, apply coupon, checkout."
---
## Procedure: Multi-item shopping checkout

Adapt element IDs to the current page. Execute steps in order.

### Phase 1 — Add items to cart
1. `read_page` — identify the first product's "Add to cart" button.
2. `click_element(id=<button>)` — add first product.
3. **Cart view opens.** `click_element` the "Close Cart" / "Continue Shopping" / "×" button to return to catalog.
4. `scroll_page` or `read_page` — locate the second product.
5. `click_element(id=<button>)` — add second product.
6. Repeat steps 3–5 for each additional item.

**Rule: After every add-to-cart, close the cart before adding the next item. Products are hidden while the cart is open.**

### Phase 2 — Coupon & shipping
7. In the cart view, `find_element(text="promo")` or `read_page` — locate the coupon input.
8. `type_text(id=<input>, text="<coupon>")` — enter the promo code.
9. `click_element(id=<apply button>)` — apply coupon. Verify discount appears.
10. `click_element(id=<shipping radio>)` — select shipping method.

### Phase 3 — Checkout
11. `type_text(id=<name field>, text="<full name>")` — enter name.
12. `type_text(id=<email field>, text="<email>")` — enter email.
13. `click_element(id=<Place Order button>)` — submit order.
14. `read_page` — verify order confirmation message appears.
15. `done(summary="Order placed successfully.")` — report completion.