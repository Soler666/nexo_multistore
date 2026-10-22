export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  STORE_OWNER = 'STORE_OWNER',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  CASHIER = 'CASHIER',
  UNASSIGNED = 'UNASSIGNED',
}

export enum SaleStatus {
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TransferStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
}

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  organizationId: string | null;
  branchId?: string | null;
  image?: string | null;
}

export interface SaleCreateDTO {
  branchId: string;
  items: {
    productId: string;
    quantity: number;
  }[];
  paymentMethod: PaymentMethod;
}

export interface BranchDTO {
  id: string;
  name: string;
  address: string;
  businessType: string;
}

export interface InventoryDTO {
  id: string;
  branchId: string;
  productId: string;
  stockAvailable: number;
  minStockAlert: number;
  localPrice: string | null;
}

export interface SaleSummaryDTO {
  today: { revenue: string | number; sales: number };
  month: { revenue: string | number; sales: number };
}
