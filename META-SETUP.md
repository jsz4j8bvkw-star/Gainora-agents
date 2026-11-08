# Instagram reading: what to set up in Meta for Developers

The Watcher reads **public** Instagram professional accounts (Business or Creator) through Meta's Graph API, using **one** connection: Gainora's own Instagram professional account, connected to Gainora's own Meta app. Clients never log in to Meta, nothing is ever posted, and no client data goes to Meta. The endpoint is Business Discovery, which returns another professional account's follower count, media count, website and recent posts (captions, like and comment counts, links). Personal and private accounts cannot be read; the app tells the owner "This account is personal or private, so its posts can't be read."

Because the token belongs to someone with a role on the app, **Standard Access** applies and no App Review is needed. Meta's access-levels page: Business apps "are automatically approved for Standard Access for all permissions and features available to their app type", and Standard Access permissions "can only be requested from app users who have a role on the requesting app". Advanced Access (any user, App Review, business verification) is only needed for the later add-on where clients connect their own accounts for private insights.

Until the two main variables below are set, nothing Instagram-related shows in the app apart from the links clients typed.

## One-off setup (about 30 minutes)

1. **An Instagram professional account for Gainora, linked to a Facebook Page.**
   In the Instagram app: Settings → Account type and tools → Switch to professional account (Business or Creator). Then link it to a Facebook Page you manage (Settings → Business tools and controls → Connect a Facebook Page; create a Page called Gainora if there isn't one). The Business Discovery call is made *from* this account, so it must be a professional account; it does not need followers or posts.

2. **A Meta app.** At developers.facebook.com → My Apps → Create App. Use case: "Other" → type **Business**. Name it Gainora Watcher. Connect it to your Business Portfolio (business.facebook.com) if asked; this is also where you'd do business verification later, but it is not needed for Standard Access.

3. **Add the products.** In the app dashboard, Add product → **Instagram** (the "Instagram API with Facebook Login" setup) and **Facebook Login for Business**. You don't need to finish any of their setup wizards for this; they only need to be on the app so the permissions exist.

4. **Give yourself a role.** App roles → Roles → Add people → Administrator (you already are, as the creator). Anyone whose token is used must have a role on the app. Keep the app in **Development mode**; that is fine for Standard Access and keeps it unreachable to the public.

5. **App settings → Basic.** Fill in Privacy policy URL `https://gainora.co.uk/privacy`, User data deletion: choose "Data deletion instructions URL" and point it at the privacy page (the section that explains how to ask for deletion), App icon and Category (Business and pages). Save. Copy the **App ID** and **App secret** (Show).

6. **Generate a token.** Tools → **Graph API Explorer**.
   - Meta App: pick Gainora Watcher. User or Page: "Get User Access Token".
   - Permissions: add `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` (the Business Discovery reference lists `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`; `pages_show_list` lets the next step list your Page).
   - Generate Access Token → log in with the Facebook account that manages the Page → in the dialog tick the Gainora Page and the Gainora Instagram account → Done.
   - In the Explorer, run `GET /me/accounts?fields=name,instagram_business_account` and copy `instagram_business_account.id`. That number is **META_IG_USER_ID**.
   - Test it: `GET /{that id}?fields=business_discovery.username(bluebottle){followers_count,media_count}` should return numbers. Try a personal account's username too; you should see `(#110) Business Discovery: User not found`, which is what the app turns into the "personal or private" message.

7. **Make the token long-lived.** The Explorer's token lasts about an hour. Either:
   - Tools → Access Token Debugger → paste the token → **Extend Access Token** (gives a long-lived User token, about 60 days), or
   - call `GET https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN` from your own machine (never from a browser page; it carries the secret).
   The long-lived token is **META_ACCESS_TOKEN**.

   Alternative with no expiry: with the long-lived User token, call `GET /me/accounts?fields=access_token` and use the **Page access token** it returns. Meta says long-lived Page tokens "do not have an expiration date" (they are invalidated if you change your password, lose the Page role or remove the app). Business Discovery accepts it as long as the Page is the one linked to the Instagram account. If you use a Page token, you can leave META_APP_ID and META_APP_SECRET unset.

8. **Netlify → Site configuration → Environment variables**, then redeploy:

   | Variable | Value | Needed |
   | --- | --- | --- |
   | `META_IG_USER_ID` | the `instagram_business_account.id` from step 6 | yes |
   | `META_ACCESS_TOKEN` | the long-lived User token or the Page token from step 7 | yes |
   | `META_APP_ID` | App ID from step 5 | only to refresh a User token automatically |
   | `META_APP_SECRET` | App secret from step 5 | only to refresh a User token automatically |
   | `META_DAILY_CAP` | how many Business Discovery calls a day across all clients; default 150 | optional |
   | `META_PER_CLIENT_CAP` | accounts read per client per day; default 10 | optional |

   Mark the token and secret as secret values in Netlify.

## How the token stays alive

- With `META_APP_ID` and `META_APP_SECRET` set, the daily run exchanges the current long-lived User token for a fresh one every 20 days (`fb_exchange_token` on `/oauth/access_token`) and keeps the newest in the service-only `job_state` table (key `meta_token`). The variable in Netlify is the fallback if the stored one is missing or expired. Meta's rule: a token can be exchanged while it is still valid; once it has expired (no exchange for 60 days) it cannot, and you repeat steps 6 and 7.
- With a Page token, nothing needs refreshing.
- If reading stops working, the Watcher logs `[gainora] instagram ... token` in the Netlify function logs and the app shows "Instagram reading is not connected right now" for competitors' accounts rather than guessing.

## What the app reads and how often

- Each client's own Instagram (if they typed it) and each watched competitor's Instagram (found on their website or typed by the owner): once a day, up to `META_PER_CLIENT_CAP` accounts per client and `META_DAILY_CAP` calls a day in total (counted in `job_state`, key `meta_calls`). When the cap is reached the previous day's figures are kept.
- Fields: `username, followers_count, media_count, website, media.limit(12){id, caption, timestamp, like_count, comments_count, permalink, media_type}`.
- Captions of *new* posts go through the AI (fast model) once, to pull out offers, prices and new treatments. Only phrases that appear word for word in the caption are kept, each linked to the post.
- Follower history is kept for 90 days per account for the trend; posting frequency is "posts in the last 30 days".

## Not in this round

- **Clients connecting their own Instagram and Facebook Page** (reach, profile visits, DMs, comments): needs Facebook Login for Business per client, Advanced Access through App Review (screencast of the login flow and each permission in use), business verification, and a table for per-client tokens. The reading code in `shared/instagram.ts` and `netlify/lib/meta.ts` is written so that a per-client token can be dropped in later.
- **Competitors' Facebook Pages**: reading another Page's public posts needs the Page Public Content Access feature, which is App Review only. The app records and shows the link.
