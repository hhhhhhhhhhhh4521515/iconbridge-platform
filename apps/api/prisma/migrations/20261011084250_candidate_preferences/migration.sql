-- AlterTable
ALTER TABLE "candidate_profiles" ADD COLUMN     "preferred_destinations" TEXT[] DEFAULT ARRAY[]::TEXT[];

