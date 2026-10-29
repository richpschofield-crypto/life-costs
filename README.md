# Life Costs

Richard's personal spending tracker (built from Boat Costs).

- App and sync server: Cloudflare Worker `life-costs` at https://life-costs.richpschofield.workers.dev/
- Database: Cloudflare D1 `life-costs`
- The Worker serves the app files in `public/` straight from this repo, so pushing to `main` updates the app within about five minutes.
- `worker.js` is the server code (deployed to Cloudflare separately).
