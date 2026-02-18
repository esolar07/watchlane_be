-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('COVERED', 'UNCOVERED');

-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "coverageStatus" "CoverageStatus" NOT NULL DEFAULT 'COVERED',
ADD COLUMN     "firstInboundAt" TIMESTAMP(3),
ADD COLUMN     "firstOutboundAt" TIMESTAMP(3),
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3);
