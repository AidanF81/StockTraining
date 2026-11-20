# Stock Training System - Server Setup

Node.js + Express API that connects Aidan's pages to Chad's RDS database.
IFT 401 Capstone, Feeley / Foster / Frazier.

## What works right now

| Function | Page | API route | Table |
|---|---|---|---|
| Create Account (with optional admin password) | CreateAccount.html | POST /api/register | UserAccount |
| Login / Logout | index.html | POST /api/login, POST /api/logout, GET /api/me | UserAccount |
| Admin Create Stock | AdminStocks.html | POST /api/admin/stocks | Stocks |
| View Stocks | AdminStocks.html (View tab) | GET /api/stocks | Stocks |
| View Portfolio | Portfolio.html | GET /api/portfolio | UserStockInfo + Stocks + UserAccount.Balance |
| Deposit Cash | DepositWithdraw.html | POST /api/deposit | UserAccount.Balance + UserHistory |
| Withdraw Cash | DepositWithdraw.html | POST /api/withdraw | UserAccount.Balance + UserHistory |
| Cash history | DepositWithdraw.html | GET /api/cash/history | UserHistory |
| Buy Stock | BuySell.html | POST /api/buy | UserAccount + Stocks + UserStockInfo + UserHistory |
| Sell Stock | BuySell.html | POST /api/sell | UserAccount + Stocks + UserStockInfo + UserHistory |
| Transaction History | History.html | GET /api/history | UserHistory |
| Market open or closed | BuySell.html | GET /api/market/status | MarketHours + MarketSchedule |
| Admin Change Market Hours | AdminMarketHours.html | POST /api/admin/market/hours | MarketHours |
| Admin Change Market Schedule | AdminMarketSchedule.html | GET and POST /api/admin/market/schedule | MarketSchedule |
| Random price generator | (runs on the server) | price_generator.py | Stocks.Price |

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
- **Deposit / Withdraw** add to or subtract from UserAccount.Balance and save a row in
  UserHistory (type Deposit or Withdraw, no ticker or shares). Withdraw refuses to go
  below zero.
- **Buy / Sell** use the current price in Stocks. Each order runs in one database
  transaction: the balance, the shares in UserStockInfo and the UserHistory row are all
  saved together or not at all. Buying needs enough cash, selling needs enough shares,
  and both are refused while the market is closed.
- **UserHistory** has no price column. For a buy or sell the price per share is the
  change in cash (NewBalance minus PreviousBalance) divided by Shares.
- **Market hours** are one row in MarketHours. If the table is empty the hours are
  09:00 to 16:00. Times are in the MARKET_TZ time zone from .env (default
  America/Phoenix) because the EC2 clock is UTC.
- **Market schedule**: Saturday and Sunday are closed and weekdays are open, unless the
  admin saved that date in MarketSchedule. IsOpen is BINARY(1) holding the character
  '1' or '0'. The closure reason is not stored: Saturday or Sunday is "Weekend", any
  other closed day is "Holiday".
- **Price generator** (Python): every 30 seconds while the market is open, each stock
  price moves up or down by up to 1.5%. Prices stay between half and double the
  InitialPrice. It asks the Node server if the market is open, so the rule lives in
  one place.
- **Portfolio "Price Change"** is the current price compared to the average price the
  user paid, worked out from their buys in UserHistory.

## Files

```
server/
  server.js             Express app: API under /api, pages served from repo root
  db.js                 MySQL pool. Finds the database automatically if DB_NAME is blank
  util.js               small helpers (boolean parsing, money and share parsing)
  market.js             works out if the market is open (hours, weekends, holidays)
  history.js            reads UserHistory: transaction list and average cost
  routes/auth.js        register / login / logout / me
  routes/stocks.js      list, search, create stocks; portfolio
  routes/cash.js        balance, deposit, withdraw, cash history
  routes/trade.js       buy, sell, transaction history
  routes/market.js      market status; admin market hours and schedule
  middleware/auth.js    requireLogin / requireAdmin
  price_generator.py    Python random price generator (runs under pm2)
  requirements.txt      Python package the price generator needs
  scripts/inspect-db.js prints every database, table and column (good for the demo)
  scripts/apply-schema-changes.js  the three table changes made on Nov 20 (already applied)
  .env.example          copy to .env and fill in
  schema_updates.sql    record of the table changes (what was applied and what was not)
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

## Step 5. Start the price generator (Python)

One time setup:

```
cd ~/StockTraining/server
sudo dnf install -y python3-pip
pip3 install --user -r requirements.txt
python3 price_generator.py --once     # one round, prints the old and new prices
```

If the market is closed it prints "market closed" and changes nothing. Then keep it
running next to the server:

```
pm2 start price_generator.py --name prices --interpreter python3
pm2 save
```

`pm2 logs prices` shows every price change. `pm2 stop prices` pauses it (useful in the
video when you want a price to hold still).

## Demo flow for the video

1. Show the AWS console: EC2 instance (Aidan) and RDS instance (Chad).
2. Show the GitHub repo and the `server/` code.
3. Create Account, then Login (wrong password first, then correct).
4. Deposit $1,000. Withdraw $1,500 (Insufficient funds). Withdraw $250. The table under
   the form shows both transactions, and they are still there after a refresh.
5. Buy/Sell: search for a stock, select it, buy 2 shares. Try to buy more than the cash
   allows (Insufficient funds). Cancel an order before sending it.
6. Switch to Sell: the holding shows average cost and current price. Sell 1 share. Try
   to sell more than you own.
7. Portfolio: shares, market price, price change and totals.
8. Transaction History: every deposit, withdrawal, buy and sell with date and balance.
9. Price generator: `pm2 logs prices` in the SSH window, then refresh the Buy/Sell page
   and show the price changed (the page also refreshes itself every 15 seconds).
10. Sign in as an admin. Create a stock. Change Market Hours so the market is closed
    right now, go back to Buy/Sell as the user and show the order is refused. Set the
    hours back.
11. Change Market Schedule: mark a weekday closed (Holiday), show it turn red.
12. Show that a regular user gets "Admin access required" on an admin page.

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
| Buy/Sell says "Market is closed" | Outside market hours, a weekend, or a day the admin closed. Check the Change Market Hours page; hours are in MARKET_TZ |
| `python3 price_generator.py` says `No module named 'pymysql'` | run `pip3 install --user -r requirements.txt` |
| Price generator says `skipped this round: URLError` | the Node server is not running (`pm2 restart sts`) |
| Price generator says `cryptography package is required` | install with the requirements file, it includes that package |
