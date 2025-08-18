import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function NPPlan() {
  const { data } = await supabase.from("plans").select();

  return (
    <>
      {data.map((item) => (
        <div
          key={item.id}
          className="grow card card-bordered glass shadow-xl max-w-[300px] max-h-[600px] rounded-xl "
        >
          {item.title}
        </div>
      ))}
    </>
  );
}
