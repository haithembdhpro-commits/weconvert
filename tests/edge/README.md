# Tests Deno des fonctions Edge

`pinned_test.ts` vérifie la requête WooCommerce épinglée sur l'IP contrôlée (anti DNS-rebinding) :
SNI/certificat du domaine boutique, gzip, chunked, mauvais certificat refusé, limite de taille.

Il a besoin d'un certificat de test pour `shop.test` signé par une CA locale :

```bash
mkdir -p /tmp/tls && cd /tmp/tls
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -subj "/CN=Test CA"
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=shop.test"
printf "subjectAltName=DNS:shop.test" > san.ext
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 2 -extfile san.ext
cd - && TLS_DIR=/tmp/tls deno test --no-check --allow-net --allow-read --allow-env tests/edge/pinned_test.ts
```
