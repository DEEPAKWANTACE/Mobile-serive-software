-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_models" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faults" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_prices" (
    "id" UUID NOT NULL,
    "device_model_id" UUID NOT NULL,
    "fault_id" UUID NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "device_models_brand_id_name_key" ON "device_models"("brand_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "faults_name_key" ON "faults"("name");

-- CreateIndex
CREATE INDEX "service_prices_fault_id_idx" ON "service_prices"("fault_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_prices_device_model_id_fault_id_key" ON "service_prices"("device_model_id", "fault_id");

-- AddForeignKey
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_device_model_id_fkey" FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_fault_id_fkey" FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
