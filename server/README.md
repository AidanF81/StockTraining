# Stock Training System - Server Setup

Node.js + Express API that connects Aidan's pages to Chad's RDS database.
IFT 401 Capstone, Feeley / Foster / Frazier.

## What works right now (mid-build functions)

| Function | Page | API route | Table |
|---|---|---|---|
| Create Account | CreateAccount.html | POST /api/register | UserAccount |
| Login / Logout | index.html | POST /api/login, POST /api/logout, GET /api/me | UserAccount |
| Admin Create Stock | AdminStocks.html | POST /api/admin/stocks | Stocks |
| View Stocks | AdminStocks.html (View tab) | GET /api/stocks | Stocks |
| View Portfolio | Portfolio.html | GET /api/portfolio | UserStockInfo + Stocks |

Passwords are hashed with bcrypt before they reach the database. Login uses the
email address (the primary key of UserAccount). Sessions are cookie-based.

## Files

```
server/
  server.js            Express app: API under /api, pages served from repo root
  db.js                MySQL connection pool (reads server/.env)
  routes/auth.js       register / login / logout / me
  routes/stocks.js     list, search, create stocks; portfolio
  middleware/auth.js   requireLogin / requireAdmin
  .env.example         copy to .env and fill in
  schema_updates.sql   recommended table changes for Chad (not needed for mid-build)
```

## Step 1. Put the code in the repo (your PC)

1. Copy the `server/` folder, `.gitignore`, and the updated HTML files into your clone of the repo.
2. `git add -A && git commit -m "Add Node/Express server and connect pages to the database"`
3. `git push`

## Step 2. Set it up on the EC2 instance

SSH in (`ec2-user@` on Amazon Linux, `ubuntu@` on Ubuntu):

```
ssh -i StockKey.pem ec2-user@3.21.231.45
```

Install Node.js if it is not there yet (`node -v` to check):

```
# Amazon Linux 2023
sudo dnf install -y nodejs npm

# Ubuntu
sudo apt update && sudo apt install -y nodejs npm
```

Pull the code and configure:

```
cd <the repo folder>        # wherever Aidan cloned it, e.g. ~/StockTraining
git pull
cd server
cp .env.example .env
nano .env                   # fill in DB_USER, DB_PASSWORD, DB_NAME, SESSION_SECRET
npm install
npm start
```

You should see `[db] Connected to g21-sts...`. Test from a second SSH window:

```
curl http://localhost:3000/api/health
# {"ok":true,"database":"connected"}
```

## Step 3. Make it reachable from the browser

Something is already serving the pages on port 80. Pick ONE of these.

**Option A: nginx is on port 80 (recommended).** Add a proxy for `/api` and
leave the pages where they are. Edit the site config (usually
`/etc/nginx/conf.d/default.conf` or `/etc/nginx/sites-available/default`) and
add inside the `server { ... }` block:

```
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`.

**Option B: Apache is on port 80.**

```
sudo a2enmod proxy proxy_http        # Ubuntu
```
Add to the VirtualHost:
```
ProxyPreserveHost On
ProxyPass /api/ http://127.0.0.1:3000/api/
ProxyPassReverse /api/ http://127.0.0.1:3000/api/
```
Then restart Apache.

**Option C: let Node serve everything on port 80.** Stop the other web server
(`sudo systemctl stop nginx` or `httpd`/`apache2`), set `PORT=80` in `.env`,
and run with `sudo npm start`. The Node server already serves the HTML/CSS.

Whichever option, open `http://3.21.231.45/` and try Create Account.

## Step 4. Keep it running after you close SSH

```
sudo npm install -g pm2
cd <repo>/server
pm2 start server.js --name sts
pm2 save
pm2 startup          # prints one command; copy and run it
```

`pm2 logs sts` shows the server output. `pm2 restart sts` after a `git pull`.

## Demo flow for the video

1. Show the AWS console: EC2 instance (Aidan) and RDS instance (Chad).
2. Show the GitHub repo and `server/` code.
3. Create Account page: register a new user. Show the row appear in UserAccount
   (MySQL Workbench or the RDS query editor). Point out the PasswordHash column.
4. Login page: wrong password first (error), then correct (lands on Portfolio,
   shows "Signed in as ...").
5. Admin > Create Stock: create two stocks. Switch to View Stocks, the table is
   loaded from the database. Show the rows in the Stocks table.
6. Portfolio page: empty state for the new user, totals at $0.00.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `[db] Not connected yet: ETIMEDOUT` | RDS security group does not allow 3.21.231.45 on 3306, or RDS is not publicly accessible |
| `ER_ACCESS_DENIED_ERROR` | wrong DB_USER / DB_PASSWORD |
| `ER_BAD_DB_ERROR` | wrong DB_NAME (the schema the tables are in) |
| `ER_NO_SUCH_TABLE` | table name case. MySQL on Linux is case-sensitive: must be exactly `Stocks`, `UserAccount`, `UserHistory`, `UserStockInfo` |
| Page says "Could not reach the server" | Node is not running, or the /api proxy in Step 3 is missing |
| Prices lose cents (150.25 saves as 150) | `Price` is INT. Chad runs block 1 of `schema_updates.sql` |

## Next (after mid-build)

Run `schema_updates.sql` (Chad), then add routes for deposit/withdraw, buy/sell,
transaction history, market hours, and the Python random price generator.
