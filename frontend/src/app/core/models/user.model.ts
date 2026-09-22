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
  has_preferred_credit_card?: boolean;
  preferred_credit_card_masked?: string;
  sky_miles: number;
  role: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export interface RegisterPayload {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  address: string;
  phone_number: string;
  email: string;
  sex: string;
  age: number;
  preferred_credit_card: string;
}
