# Stock Training System - Server Setup

Node.js + Express API that connects Aidan's pages to Chad's RDS database.
IFT 401 Capstone, Feeley / Foster / Frazier.

## What works right now (mid-build functions)

| Function | Page | API route | Table |
|---|---|---|---|
| Create Account (with optional admin password) | CreateAccount.html | POST /api/register | UserAccount |
| Login / Logout | index.html | POST /api/login, POST /api/logout, GET /api/me | UserAccount |
| Admin Create Stock | AdminStocks.html | POST /api/admin/stocks | Stocks |
| View Stocks | AdminStocks.html (View tab) | GET /api/stocks | Stocks |
| View Portfolio | Portfolio.html | GET /api/portfolio | UserStockInfo + Stocks + UserAccount.Balance |
| Deposit Cash | DepositWithdraw.html | POST /api/deposit | UserAccount.Balance |
| Withdraw Cash | DepositWithdraw.html | POST /api/withdraw | UserAccount.Balance |

How the pieces fit:

- **Passwords** are hashed with bcrypt before they reach the database. A row whose
  PasswordHash was typed in by hand (like the default admin) still works: the server
  accepts the plain password once and replaces it with a hash on that first login.
- **Password rules** (from the Systems Design doc): at least 8 characters, with a letter,
  a number, and a special character, and not containing the email name.
- **Login** uses the email address (the primary key of UserAccount). Admins land on
  AdminStocks.html, everyone else on Portfolio.html.
- **Admins** are rows with IsAdmin = 1. At sign-up, entering the default admin account's
  password (Admin@admin.com) in the "Admin Password" box creates an admin account. The
  admin API routes return 403 for anyone else. ADMIN_EMAILS in .env can add extra admins.
- **Deposit / Withdraw** add to or subtract from UserAccount.Balance. Withdraw refuses to
  go below zero. Balance is an INT right now, so cents are rounded; block 1 of
  schema_updates.sql fixes that.

## Files

```
server/
  server.js             Express app: API under /api, pages served from repo root
  db.js                 MySQL pool. Finds the database automatically if DB_NAME is blank
  util.js               small helpers (boolean parsing, money parsing)
  routes/auth.js        register / login / logout / me
  routes/stocks.js      list, search, create stocks; portfolio
  routes/cash.js        balance, deposit, withdraw
  middleware/auth.js    requireLogin / requireAdmin
  scripts/inspect-db.js prints every database, table and column (good for the demo)
  .env.example          copy to .env and fill in
  schema_updates.sql    recommended table changes for Chad (not needed for mid-build)
```

## Step 1. Code into the repo (your PC)

Copy the `server/` folder, `.gitignore`, and the updated HTML files into your clone,
then `git add -A`, `git commit -m "..."`, `git push`.

## Step 2. Set it up on the EC2 instance (Amazon Linux)

```
ssh -i StockKey.pem ec2-user@3.20.197.187
cd ~/StockTraining
git pull
cd server
cp .env.example .env     # skip if .env already exists
nano .env                # DB_USER, DB_PASSWORD, SESSION_SECRET. DB_NAME can stay blank.
npm install
node scripts/inspect-db.js   # optional: shows the database, tables, columns
npm start
```

You should see `[db] Connected to g21-sts..., database "<name>"`. Test from a second SSH window:

```
curl http://localhost:3000/api/health
# {"ok":true,"database":"connected"}
```

## Step 3. nginx on port 80 (Aidan set this up)

nginx passes everything to the Node server on port 3000. The block in the nginx
site config should look like this:

```
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`sudo nginx -t && sudo systemctl reload nginx` after any change. Then open
`http://3.20.197.187/`. If the sign-in page asks for "Email Address", nginx is
reaching the Node server.

## Step 4. Keep it running after you close SSH

```
sudo npm install -g pm2
cd ~/StockTraining/server
pm2 start server.js --name sts
pm2 save
pm2 startup          # prints one command; copy and run it
```

`pm2 logs sts` shows the server output. `pm2 restart sts` after a `git pull`.

## Demo flow for the video

1. Show the AWS console: EC2 instance (Aidan) and RDS instance (Chad).
2. Show the GitHub repo and the `server/` code.
3. Create Account: register a regular user. Show the row appear in UserAccount
   (MySQL Workbench, or `node scripts/inspect-db.js`). Point out PasswordHash.
4. Login: wrong password first (error), then correct. Lands on Portfolio with
   "Signed in as ...", cash $0.00.
5. Deposit $1,000. Withdraw $1,500 (Insufficient funds). Withdraw $250. Balance $750.
   Portfolio now shows $750 cash.
6. Sign out. Sign in as Admin@admin.com. Lands on the admin page.
   Create two stocks. View Stocks tab lists them from the database.
7. Show that a regular user who tries to create a stock gets "Admin access required".

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `[db] Not connected yet: ETIMEDOUT` | RDS is stopped (Chad stops it when not in use), or the security group does not allow 3.20.197.187 on 3306 |
| `ER_ACCESS_DENIED_ERROR` | wrong DB_USER / DB_PASSWORD |
| `No database with a UserAccount table was found` | the login cannot see the schema; set DB_NAME in .env by hand |
| `ER_NO_SUCH_TABLE` | table name case. MySQL on Linux is case-sensitive: `Stocks`, `UserAccount`, `UserHistory`, `UserStockInfo` |
| `ER_BAD_FIELD_ERROR` mentioning Balance or IsAdmin | Chad's columns are not there; the server falls back to regular accounts and $0 cash |
| Page says "Could not reach the server" | Node is not running, or nginx is not proxying to port 3000 |
| Sign-in page still asks for "Username" | nginx is serving the old static files instead of proxying to Node |
| Prices or balances lose cents | INT columns. Chad runs block 1 of `schema_updates.sql` |

## Next (after mid-build)

Run `schema_updates.sql` (Chad), then add buy/sell, transaction history, market
hours/schedule, and the Python random price generator.
