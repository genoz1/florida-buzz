# Buzz Merch + Printify Pop-Up Store

Florida Buzz does **not** run checkout itself. Your [Printify Pop-Up Store](https://help.printify.com/hc/en-us/articles/12051129478417-What-is-Printify-Pop-Up-Store) collects payment, prints, ships, and pays you out. The website page at `/merch` showcases a couple of products and deep-links into that store.

## You do **not** put colors / sizes / prices in env vars

Printify already owns:

- every color and size variant  
- live price  
- cart, tax, shipping, payment  

On Florida Buzz you only list **~2 product cards** (title + image + link to the Printify product page). Shoppers pick color/size on Printify.

## Edit one JSON file (normal path)

Open `content/merch-products.json` and fill in your real store + two products:

```json
{
  "storeUrl": "https://YOUR-STORE.printify.me",
  "storeName": "Florida Buzz Merch",
  "products": [
    {
      "id": "tee-1",
      "title": "Park Day Tee",
      "url": "https://YOUR-STORE.printify.me/product/abc123",
      "imageUrl": "https://images-api.printify.com/....jpg",
      "description": "Soft tee for rope drop. Pick size and color on Printify."
    },
    {
      "id": "tee-2",
      "title": "Sunset Buzz Tee",
      "url": "https://YOUR-STORE.printify.me/product/def456",
      "imageUrl": "https://images-api.printify.com/....jpg",
      "description": "Second drop. Sizes and colors on Printify."
    }
  ]
}
```

Commit and deploy. Placeholder `YOUR-STORE` / `Replace with…` rows are ignored until you replace them.

### Where to copy links in Printify

1. Pop-Up Store dashboard → store URL → `storeUrl`
2. Open product 1 → product page URL → `products[0].url`
3. Right-click a mockup image → copy image address → `imageUrl`
4. Repeat for product 2

Optional: omit `price` on the site (recommended) so you don’t fight Printify when variants differ.

## Optional DigitalOcean override

Only if you want the store home URL in App Platform without editing the file:

| Variable | Purpose |
|---|---|
| `PRINTIFY_STORE_URL` | Overrides `storeUrl` from the JSON file |

You should **not** need per-color / per-size env vars.

## Optional: `shop.thefloridabuzz.com`

In Printify: Store Settings → Your domains → connect a subdomain. Point DNS as Printify instructs. Put that URL in `storeUrl`. `/merch` on the main site stays the branded landing page.

## Money flow

Customer pays Printify → Printify prints & ships → Printify pays you (after Stripe verification). No cart code on Florida Buzz.
