# Buzz Merch + Printify Pop-Up Store

Florida Buzz does **not** run checkout itself. Your [Printify Pop-Up Store](https://help.printify.com/hc/en-us/articles/12051129478417-What-is-Printify-Pop-Up-Store) collects payment, prints, ships, and pays you out. The website page at `/merch` showcases products and deep-links into that store.

## Why not embed the store?

Printify Pop-Up Stores are meant to be shared as a storefront URL (`your-store.printify.me` or a custom domain). Iframes are unreliable and a poor fit for card checkout. Linking out is the supported path.

## DigitalOcean env vars

Set these on the App Platform component, then redeploy:

| Variable | Purpose |
|---|---|
| `PRINTIFY_STORE_URL` | Your store home, e.g. `https://florida-buzz.printify.me` |
| `PRINTIFY_FEATURED_TITLE` | Shirt name shown on `/merch` |
| `PRINTIFY_FEATURED_URL` | Direct product page URL from Printify |
| `PRINTIFY_FEATURED_IMAGE_URL` | Product image URL (right-click image on Printify → copy) |
| `PRINTIFY_FEATURED_PRICE` | Optional display price, e.g. `$28` |
| `PRINTIFY_FEATURED_DESCRIPTION` | Optional one-line pitch |

For more than one product, use JSON instead of the `FEATURED_*` shortcuts:

```bash
PRINTIFY_PRODUCTS='[{"title":"Florida Buzz Tee","url":"https://your-store.printify.me/product/123","imageUrl":"https://images-api.printify.com/...","price":"$28","description":"Soft tee for park days."}]'
```

## Where to copy links in Printify

1. Open your Pop-Up Store dashboard → copy the store URL → `PRINTIFY_STORE_URL`.
2. Open the shirt product → copy that product URL → `PRINTIFY_FEATURED_URL`.
3. Copy a product mockup image URL → `PRINTIFY_FEATURED_IMAGE_URL`.

## Optional: `shop.thefloridabuzz.com`

In Printify: Store Settings → Your domains → connect a subdomain (e.g. `shop.thefloridabuzz.com`). Point DNS as Printify instructs. Then set `PRINTIFY_STORE_URL` to that custom domain. `/merch` on the main site still works as the branded landing page.

## Money flow

Customer pays Printify → Printify prints & ships → Printify pays you (after Stripe verification in Printify). No cart code on Florida Buzz.
