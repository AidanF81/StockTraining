#!/usr/bin/env python3
# Adam Frazier - IFT 401 Stock Training System
# Random stock price generator.
#
# Every PRICE_INTERVAL_SECONDS (default 30) it moves the price of every stock in the
# Stocks table up or down by a small random percent. It only does this while the market
# is open, so prices dont move at night, on weekends or on holidays.
#
# Setup on the EC2 instance (one time):
#   sudo dnf install -y python3-pip
#   pip3 install --user -r requirements.txt
#
# Run it once to test:
#   python3 price_generator.py --once
# Keep it running (same as the node server):
#   pm2 start price_generator.py --name prices --interpreter python3
#   pm2 save
#
# It uses the same .env file as the node server for the database login.
# Optional settings in .env:
#   PRICE_INTERVAL_SECONDS=30   how often prices change
#   PRICE_MAX_MOVE_PERCENT=1.5  the biggest move up or down in one change

import json
import os
import random
import sys
import time
import urllib.request
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

import pymysql

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env(path):
    """Read KEY=value lines from the .env file. Lines starting with # are skipped."""
    values = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                value = value.strip()
                # Read the value the same way the node dotenv package does, so both programs
                # get the same password: a quoted value is whatever is inside the quotes,
                # and an unquoted value stops at the first #
                if value[:1] in ("'", '"', "`") and value.find(value[0], 1) != -1:
                    value = value[1:value.find(value[0], 1)]
                else:
                    value = value.split("#", 1)[0].strip()
                values[key.strip()] = value
    except FileNotFoundError:
        pass
    return values


ENV = load_env(os.path.join(HERE, ".env"))


def setting(name, default=""):
    # a real environment variable wins over the .env file
    return os.environ.get(name) or ENV.get(name) or default


INTERVAL = max(5, int(float(setting("PRICE_INTERVAL_SECONDS", "30"))))
MAX_MOVE = min(50.0, max(0.01, float(setting("PRICE_MAX_MOVE_PERCENT", "1.5")))) / 100
SERVER_PORT = setting("PORT", "3000")
CENT = Decimal("0.01")


def log(message):
    print(f"[prices {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def connect():
    conn = pymysql.connect(
        host=setting("DB_HOST"),
        port=int(setting("DB_PORT", "3306")),
        user=setting("DB_USER"),
        password=setting("DB_PASSWORD"),
        connect_timeout=10,
        autocommit=False,
    )
    name = setting("DB_NAME")
    if not name:
        # DB_NAME is blank in our .env, so find the database that has the Stocks table
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT TABLE_SCHEMA FROM information_schema.TABLES "
                "WHERE LOWER(TABLE_NAME) = 'stocks' "
                "AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
            )
            found = [row[0] for row in cur.fetchall()]
        if len(found) != 1:
            raise RuntimeError(f"Expected one database with a Stocks table, found {len(found)}. Set DB_NAME in .env.")
        name = found[0]
    conn.select_db(name)
    return conn


def market_is_open():
    """Ask the node server, so there is only one place that decides if the market is open."""
    url = f"http://127.0.0.1:{SERVER_PORT}/api/market/status"
    with urllib.request.urlopen(url, timeout=5) as response:
        status = json.load(response)
    return bool(status.get("open")), status.get("reason")


def new_price(price, initial):
    """Move the price by a random percent between -MAX_MOVE and +MAX_MOVE."""
    change = Decimal(str(random.uniform(-MAX_MOVE, MAX_MOVE)))
    moved = (price * (1 + change)).quantize(CENT, rounding=ROUND_HALF_UP)

    # keep it between half and double the initial price so it cant drift to $0 or get huge during a demo
    low, high = CENT, None
    if initial is not None and initial > 0:
        low = max(CENT, (initial / 2).quantize(CENT, rounding=ROUND_HALF_UP))
        high = initial * 2
    moved = max(moved, low)
    if high is not None:
        moved = min(moved, high)

    # if rounding or a limit left it on the same price, move it one cent (staying inside the limits)
    if moved == price:
        can_go_up = high is None or price + CENT <= high
        can_go_down = price - CENT >= low
        if (change >= 0 and can_go_up) or not can_go_down:
            moved = price + CENT if can_go_up else price
        else:
            moved = price - CENT
    return moved


def update_prices(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT StockTicker, Price, InitialPrice FROM Stocks ORDER BY StockTicker")
        stocks = cur.fetchall()
        changes = []
        for ticker, price, initial in stocks:
            price = Decimal(str(price))
            initial = None if initial is None else Decimal(str(initial))
            moved = new_price(price, initial)
            cur.execute("UPDATE Stocks SET Price = %s WHERE StockTicker = %s", (str(moved), ticker))
            changes.append(f"{ticker} {price} -> {moved}")
    conn.commit()
    return changes


def tick():
    is_open, reason = market_is_open()
    if not is_open:
        log(f"market closed ({reason}), prices not changed")
        return
    # new connection each time. its only every 30 seconds and it means a dropped connection overnight cant break it
    conn = connect()
    try:
        changes = update_prices(conn)
    finally:
        conn.close()
    log(", ".join(changes) if changes else "no stocks in the table yet")


def main():
    once = "--once" in sys.argv
    log(f"started, every {INTERVAL}s, max move {MAX_MOVE * 100:.2f}%")
    while True:
        try:
            tick()
        except Exception as err:  # keep going, the server or database might just be restarting
            log(f"skipped this round: {type(err).__name__}: {err}")
            if once:
                sys.exit(1)
        if once:
            break
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
