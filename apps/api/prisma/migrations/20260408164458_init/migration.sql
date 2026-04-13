-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('planning', 'active', 'completed', 'on_hold');

-- CreateEnum
CREATE TYPE "EpicStatus" AS ENUM ('draft', 'in_progress', 'done', 'blocked');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateTable
CREATE TABLE "initiatives" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "InitiativeStatus" NOT NULL DEFAULT 'planning',
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "owner" TEXT NOT NULL,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epics" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "EpicStatus" NOT NULL DEFAULT 'draft',
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "qualitativeBenefits" TEXT NOT NULL DEFAULT '',
    "quantitativeBenefits" TEXT NOT NULL DEFAULT '',
    "benefitsMeasurement" TEXT NOT NULL DEFAULT '',
    "scopeDescription" TEXT NOT NULL DEFAULT '',
    "acceptanceCriteria" TEXT NOT NULL DEFAULT '',
    "technologicalImprovements" TEXT NOT NULL DEFAULT '',
    "businessPriority" TEXT NOT NULL DEFAULT '',
    "teamsInvolved" TEXT NOT NULL DEFAULT '',
    "impactedChannels" TEXT NOT NULL DEFAULT '',
    "impactedFlows" TEXT NOT NULL DEFAULT '',
    "impactSabreLevel" TEXT NOT NULL DEFAULT '',
    "thirdPartyDependencies" TEXT NOT NULL DEFAULT '',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "diagrams" JSONB NOT NULL DEFAULT '[]',
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "poApproval" JSONB,
    "tlApproval" JSONB,
    "qaApproval" JSONB,
    "qaMatrix" JSONB,
    "epicQAMatrix" JSONB,
    "tracker" JSONB,
    "initiativeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "epics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_owners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epic_pods" (
    "epicId" TEXT NOT NULL,
    "podId" TEXT NOT NULL,

    CONSTRAINT "epic_pods_pkey" PRIMARY KEY ("epicId","podId")
);

-- CreateTable
CREATE TABLE "pod_product_owners" (
    "podId" TEXT NOT NULL,
    "productOwnerId" TEXT NOT NULL,

    CONSTRAINT "pod_product_owners_pkey" PRIMARY KEY ("podId","productOwnerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "pods_name_key" ON "pods"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_owners_email_key" ON "product_owners"("email");

-- AddForeignKey
ALTER TABLE "epics" ADD CONSTRAINT "epics_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epic_pods" ADD CONSTRAINT "epic_pods_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "epics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epic_pods" ADD CONSTRAINT "epic_pods_podId_fkey" FOREIGN KEY ("podId") REFERENCES "pods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_owners" ADD CONSTRAINT "pod_product_owners_podId_fkey" FOREIGN KEY ("podId") REFERENCES "pods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_owners" ADD CONSTRAINT "pod_product_owners_productOwnerId_fkey" FOREIGN KEY ("productOwnerId") REFERENCES "product_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
