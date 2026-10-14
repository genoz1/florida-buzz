# Buzz Merch + Shopify

## Integration model (brand-first)

Florida Buzz owns the **merch experience**. Shopify is the **checkout engine**.

| Layer | Where | What the visitor sees |
|---|---|---|
| Browse / brand | `thefloridabuzz.com/merch` | Full Florida Buzz header, fonts, colors, copy, featured tees |
| Product detail + cart + pay | Shopify storefront | Prefer a custom domain like `shop.thefloridabuzz.com` so it still feels like us |
| Fulfillment | Shopify (+ print-on-demand app if connected) | Behind the scenes |

Do **not** iframe a raw Shopify catalog into the site — that looks bolted on. Do keep `/merch` as a first-class Florida Buzz page (already in the main nav next to Podcasts / Guides).

Button copy stays Florida Buzz–native (“Get yours”, “Shop merch”) — never “Buy on Shopify” in the hero.

(Printify Pop-Up Store is still supported if you ever switch back — same JSON shape.)

## You do **not** put colors / sizes / prices in env vars

Shopify already owns:

- every color and size variant
- live price
- cart, tax, shipping, payment

On Florida Buzz you only list **~2 product cards** (title + image + link to the Shopify product page). Shoppers pick color/size on Shopify.

## Edit one JSON file (normal path)

Open `content/merch-products.json` and fill in your real store + products:

```json
{
  "provider": "shopify",
  "storeUrl": "https://your-store.myshopify.com",
  "storeName": "Florida Buzz Merch",
  "products": [
    {
      "id": "caught-my-buzz-tee",
      "title": "I Caught My Buzz in Florida Tee",
      "url": "https://your-store.myshopify.com/products/i-caught-my-buzz-in-florida",
      "imageUrl": "https://cdn.shopify.com/s/files/....jpg",
      "description": "The soon-to-be-famous Florida Buzz tee. Pick size and color at checkout on Shopify."
    }
  ]
}
```

Commit and deploy. Placeholder `YOUR-STORE` / `Replace with…` rows are ignored until you replace them.

### Where to copy links in Shopify

1. Admin → Online Store → Domains (or Settings → Domains) → storefront URL → `storeUrl`  
   (`.myshopify.com` is fine; a custom domain like `shop.thefloridabuzz.com` is better once connected)
2. Products → open product → copy the product page URL → `products[n].url`
3. Product media → copy image URL (or right-click the storefront image) → `imageUrl`
4. Feature the **I Caught My Buzz in Florida** tee first

Optional: omit `price` on the site so you don’t fight Shopify when variants differ.

## Optional DigitalOcean override

| Variable | Purpose |
|---|---|
| `MERCH_STORE_URL` or `SHOPIFY_STORE_URL` | Overrides `storeUrl` from the JSON file |
| `MERCH_STORE_NAME` | Display name override |
| `PRINTIFY_STORE_URL` | Legacy alias (still works) |

## Optional: `shop.thefloridabuzz.com`

In Shopify: Settings → Domains → connect a subdomain. Point DNS as Shopify instructs. Put that URL in `storeUrl`. `/merch` on the main site stays the branded landing page.

## Money flow

Customer pays on Shopify → order is fulfilled (manual or print-on-demand app) → payouts go to your Shopify / bank setup. No cart code on Florida Buzz.
