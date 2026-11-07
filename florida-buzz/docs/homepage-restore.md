# Homepage restore

The previous news-feed homepage is saved at `views/home-news-feed-backup.ejs`.

The current photo-led homepage (`views/home.ejs`) expects these locals from `routes/main.js`:

- `featuredLead`, `featuredSide`, `moreThemeParks`, `aroundFlorida`
- `guides`, `tools`, podcast fields
- `ticker: []` (homepage hides the scrolling ticker)

Selection helpers live in `lib/homePage.js`.

To restore the older news-feed layout:

```bash
cp views/home-news-feed-backup.ejs views/home.ejs
```

Then revert the homepage handler in `routes/main.js` to the `featured` / `secondary` / `byCategory` / `ticker` locals the backup template uses.
