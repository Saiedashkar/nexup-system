-- Add indexes for better query performance

-- User table indexes
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_businessId_idx" ON "User"("businessId");

-- Client table indexes
CREATE INDEX IF NOT EXISTS "Client_businessId_idx" ON "Client"("businessId");
CREATE INDEX IF NOT EXISTS "Client_phone_idx" ON "Client"("phone");
CREATE INDEX IF NOT EXISTS "Client_tier_idx" ON "Client"("tier");
CREATE INDEX IF NOT EXISTS "Client_createdAt_idx" ON "Client"("createdAt" DESC);

-- ProjectRecord table indexes
CREATE INDEX IF NOT EXISTS "ProjectRecord_businessId_idx" ON "ProjectRecord"("businessId");
CREATE INDEX IF NOT EXISTS "ProjectRecord_clientId_idx" ON "ProjectRecord"("clientId");
CREATE INDEX IF NOT EXISTS "ProjectRecord_date_idx" ON "ProjectRecord"("date" DESC);
CREATE INDEX IF NOT EXISTS "ProjectRecord_workStatus_idx" ON "ProjectRecord"("workStatus");
CREATE INDEX IF NOT EXISTS "ProjectRecord_paymentStatus_idx" ON "ProjectRecord"("paymentStatus");
CREATE INDEX IF NOT EXISTS "ProjectRecord_clientType_idx" ON "ProjectRecord"("clientType");

-- ClientPayment table indexes
CREATE INDEX IF NOT EXISTS "ClientPayment_projectRecordId_idx" ON "ClientPayment"("projectRecordId");
CREATE INDEX IF NOT EXISTS "ClientPayment_date_idx" ON "ClientPayment"("date" DESC);

-- Expense table indexes
CREATE INDEX IF NOT EXISTS "Expense_businessId_idx" ON "Expense"("businessId");
CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense"("date" DESC);
CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense"("category");
CREATE INDEX IF NOT EXISTS "Expense_month_year_idx" ON "Expense"("month", "year");

-- PoolTransaction table indexes
CREATE INDEX IF NOT EXISTS "PoolTransaction_businessId_idx" ON "PoolTransaction"("businessId");
CREATE INDEX IF NOT EXISTS "PoolTransaction_type_idx" ON "PoolTransaction"("type");
CREATE INDEX IF NOT EXISTS "PoolTransaction_date_idx" ON "PoolTransaction"("date" DESC);

-- Deal table indexes (ABOMAZEN)
CREATE INDEX IF NOT EXISTS "Deal_businessId_idx" ON "Deal"("businessId");
CREATE INDEX IF NOT EXISTS "Deal_propertyId_idx" ON "Deal"("propertyId");
CREATE INDEX IF NOT EXISTS "Deal_date_idx" ON "Deal"("date" DESC);
CREATE INDEX IF NOT EXISTS "Deal_dealType_idx" ON "Deal"("dealType");

-- Property table indexes (ABOMAZEN)
CREATE INDEX IF NOT EXISTS "Property_businessId_idx" ON "Property"("businessId");
CREATE INDEX IF NOT EXISTS "Property_status_idx" ON "Property"("status");
CREATE INDEX IF NOT EXISTS "Property_listingType_idx" ON "Property"("listingType");

-- Subscription table indexes (REBOUND)
CREATE INDEX IF NOT EXISTS "Subscription_clientId_idx" ON "Subscription"("clientId");
CREATE INDEX IF NOT EXISTS "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX IF NOT EXISTS "Subscription_startDate_idx" ON "Subscription"("startDate" DESC);

-- ProfitTransfer table indexes
CREATE INDEX IF NOT EXISTS "ProfitTransfer_businessId_idx" ON "ProfitTransfer"("businessId");
CREATE INDEX IF NOT EXISTS "ProfitTransfer_partnerId_idx" ON "ProfitTransfer"("partnerId");
CREATE INDEX IF NOT EXISTS "ProfitTransfer_date_idx" ON "ProfitTransfer"("date" DESC);

-- OfficeExpense table indexes
CREATE INDEX IF NOT EXISTS "OfficeExpense_date_idx" ON "OfficeExpense"("date" DESC);
CREATE INDEX IF NOT EXISTS "OfficeExpense_category_idx" ON "OfficeExpense"("category");

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS "ProjectRecord_business_date_idx" ON "ProjectRecord"("businessId", "date" DESC);
CREATE INDEX IF NOT EXISTS "Client_business_tier_idx" ON "Client"("businessId", "tier");
CREATE INDEX IF NOT EXISTS "Expense_business_date_idx" ON "Expense"("businessId", "date" DESC);
