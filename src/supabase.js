import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://giuakrzudpdlgctqeemf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdWFrcnp1ZHBkbGdjdHFlZW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjE0NjMsImV4cCI6MjA5ODMzNzQ2M30.y9rFBR_5qeOq2YhDTW2cL4AJfOb9enoIuWb35k_JxiU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
