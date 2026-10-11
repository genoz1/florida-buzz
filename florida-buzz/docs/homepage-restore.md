# Homepage restore

The previous news-feed homepage is saved at `views/home-news-feed-backup.ejs`.

To restore it:

```bash
cp views/home-news-feed-backup.ejs views/home.ejs
```

Then revert `routes/main.js` homepage render locals if needed (guides, tools, podcast fields), or keep the richer locals — the backup template only uses the original `featured` / `secondary` / `byCategory` / `ticker` fields.
