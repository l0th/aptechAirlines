export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  CLERK = 'CLERK',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export interface User {
  _id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  address?: string;
  sex?: string;
  age?: number;
  preferred_credit_card?: string;
  sky_miles: number;
  role: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}
