-- Recommended changes to the tables, so the remaining functions (buy/sell, history,
-- market hours, price generator) can be built. Nothing here is required for the
-- mid-build demo. Chad: run whichever blocks you agree with, one at a time, in order.
--
-- Already done by Chad (Oct 17): UserAccount.Balance (INT) and UserAccount.IsAdmin,
-- plus the default admin account.

-- 1. Money columns need cents. INT rounds 150.25 to 150.
ALTER TABLE Stocks
    MODIFY Price DECIMAL(10,2) NOT NULL;
ALTER TABLE UserAccount
    MODIFY Balance DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 2. Keep the price the admin set at creation, separate from the moving price
--    the random price generator will update.
ALTER TABLE Stocks
    ADD COLUMN InitialPrice DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER CompanyName;
UPDATE Stocks SET InitialPrice = Price WHERE InitialPrice = 0;

-- 3. UserHistory needs to know WHOSE transaction it is, the price at the time,
--    and when it happened.
ALTER TABLE UserHistory
    ADD COLUMN Email VARCHAR(255) NOT NULL AFTER TransactionID,
    ADD COLUMN PricePerShare DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN TransactionDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT fk_history_user FOREIGN KEY (Email) REFERENCES UserAccount(Email);

-- 4. Cash deposits and withdrawals (separate from stock trades). Once this exists,
--    the Deposit/Withdraw page's "Recent cash transactions" table can be filled.
CREATE TABLE IF NOT EXISTS CashTransaction (
    CashTransactionID INT AUTO_INCREMENT PRIMARY KEY,
    Email VARCHAR(255) NOT NULL,
    TransactionType VARCHAR(20) NOT NULL,          -- 'Deposit' or 'Withdraw'
    Amount DECIMAL(12,2) NOT NULL,
    BalanceAfter DECIMAL(12,2) NOT NULL,
    TransactionDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cash_user FOREIGN KEY (Email) REFERENCES UserAccount(Email)
);

-- 5. Market hours and schedule (admin functions).
CREATE TABLE IF NOT EXISTS MarketHours (
    ID INT PRIMARY KEY DEFAULT 1,
    OpenHour TINYINT NOT NULL DEFAULT 9,
    CloseHour TINYINT NOT NULL DEFAULT 16
);
INSERT IGNORE INTO MarketHours (ID, OpenHour, CloseHour) VALUES (1, 9, 16);

CREATE TABLE IF NOT EXISTS MarketSchedule (
    ScheduleDate DATE PRIMARY KEY,
    IsOpen TINYINT(1) NOT NULL DEFAULT 1,
    ClosureReason VARCHAR(50) NULL                 -- 'Weekend', 'Holiday'
);

-- 6. Price history, written by the random price generator.
CREATE TABLE IF NOT EXISTS PriceHistory (
    PriceID INT AUTO_INCREMENT PRIMARY KEY,
    StockTicker VARCHAR(50) NOT NULL,
    Price DECIMAL(10,2) NOT NULL,
    RecordedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_price_stock FOREIGN KEY (StockTicker) REFERENCES Stocks(StockTicker)
);
