-- Enable Supabase Realtime on orders table for live buyer-seller order flow
alter publication supabase_realtime add table orders;
