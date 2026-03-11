DELETE FROM products WHERE id IN (
  'b1beb2e1-437b-4b2b-b922-77137b1ea72c',
  '944a9ee5-a119-4b7a-84e5-6c3bf00c3a30',
  '18a83bc6-7438-4bf3-acc9-97b75f9fafdb',
  '5c992bdd-f9cf-49aa-8dd3-cb4fe1665d98'
);

UPDATE products SET sku = '80016' WHERE id = '6c8416f1-c828-4f24-a9e6-09a2bff788d2';
UPDATE products SET sku = '80018' WHERE id = '0819201c-e871-4a39-82b2-477dbd264e23';
UPDATE products SET sku = '80022' WHERE id = '68604907-b83a-49ca-9825-239e39becad8';