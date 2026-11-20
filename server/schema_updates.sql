-- Record of the table changes for the final build.
-- Chad built the tables. On Nov 20 Adam applied three small changes from the server with
-- scripts/apply-schema-changes.js. This file is the same changes as plain SQL so the
-- final tables can be documented. Nothing here needs to be run again.

-- 1. Stock prices need cents. INT rounds 150.25 to 150.
ALTER TABLE Stocks
    MODIFY Price DECIMAL(10,2) NOT NULL;

-- 2. Keep the price the admin set at creation, separate from the moving price
--    the random price generator updates.
ALTER TABLE Stocks
    ADD COLUMN InitialPrice DECIMAL(10,2) NULL;
UPDATE Stocks SET InitialPrice = Price WHERE InitialPrice IS NULL;

-- 3. Deposits and withdrawals are saved in UserHistory too. They have no stock,
--    so StockTicker and Shares have to allow NULL.
ALTER TABLE UserHistory
    MODIFY StockTicker VARCHAR(50) NULL,
    MODIFY Shares INT NULL;

-- Not changed, handled in the server code instead:
--   MarketSchedule.IsOpen is BINARY(1) holding the character '1' or '0'.
--   There is no closure reason column (Saturday/Sunday = Weekend, otherwise Holiday).
--   There is no price history table. The generator updates Stocks.Price directly.
