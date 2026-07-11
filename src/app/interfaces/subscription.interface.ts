export interface subscriptionPlans {
  plan_name: string;
  company_id?: string;
  user_id?: string;
  price: number;
  billing_cycle: "Monthly" | "Yearly" | "Free";
  description: string;
  active: boolean;

  features: {
    [key: string]: {
      limit_type: string;
      limit_value: number | null;
    };
  };
}
