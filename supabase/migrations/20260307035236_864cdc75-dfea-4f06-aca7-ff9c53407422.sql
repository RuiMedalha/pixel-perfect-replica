
-- Change focus_keyword from text to text[] (array of keywords)
ALTER TABLE public.products 
  ALTER COLUMN focus_keyword TYPE text[] USING 
    CASE WHEN focus_keyword IS NOT NULL AND focus_keyword != '' 
      THEN ARRAY[focus_keyword] 
      ELSE NULL 
    END;
