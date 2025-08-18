//"use server";

import { createClient } from "@supabase/supabase-js";
import { FunctionSquareIcon } from "lucide-react";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleSecret = process.env.SUPABASE_SERVICE_KEY;

export const supabase = createClient(supabaseUrl, serviceRoleSecret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
