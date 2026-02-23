-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "credentialId" TEXT;

-- CreateTable
CREATE TABLE "Credentials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Credentials_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Credentials" ADD CONSTRAINT "Credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
