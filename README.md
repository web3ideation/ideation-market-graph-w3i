# ideation-market-graph-w3i

Subgraph for the **IdeationMarket Diamond** (EIP-2535). It indexes the marketplace’s listing lifecycle and per-listing buyer whitelists into two minimal entities for fast UI queries.

- **Network:** Sepolia (chainId `11155111`)
- **Diamond (proxy):** `0x8cE90712463c87a6d62941D67C3507D090Ea9d79`
- **Data sources:** `IdeationMarketFacet` (listings), `BuyerWhitelistFacet` (whitelist)
- **Entities:** `Listing`, `WhitelistedBuyer`

---

## What’s indexed

### `Listing` (one row per `listingId`)
- `listingId`, `tokenAddress`, `tokenId`, `tokenStandard`
- `erc1155QuantityListed` (snapshot at create)
- `remainingQuantity` (decrements on each purchase; `null` for ERC-721)
- `priceTotal` (remaining total; for ERC-721 becomes `0` after sale)
- `unitPrice` (set only if partial buys are enabled for ERC-1155)
- Flags: `buyerWhitelistEnabled`, `partialBuyEnabled`
- `listingType` (`PURE_ETH` | `SWAP_AND_ETH` | `PURE_SWAP`)
- `feeRate` (snapshot at create/update; denominator `100_000`)
- Swap targets: `desiredTokenAddress`, `desiredTokenId`, `desiredErc1155Quantity`
- `seller`, `status` (`LISTED` | `PARTIALLY_FILLED` | `SOLD_OUT` | `CANCELED` | `INVALIDATED`), `active`
- `createdAt`

### `WhitelistedBuyer` (presence = whitelisted)
- `listingId`, `buyer`, `createdAt`

> We intentionally avoid arrays on the listing. Whitelist membership is represented as separate rows keyed by `(listingId, buyer)` and **deleted** on revoke.

---

## Getting started

Tooling is pinned to a Graph CLI version that works with Node 20.10.0.

```bash
yarn install
# If not present already:
yarn add -D @graphprotocol/graph-cli@0.90.0 @graphprotocol/graph-ts@0.36.0
```

### Project layout
```
/abis
  IdeationMarketFacet.json
  BuyerWhitelistFacet.json
/src
  mapping.ts
/schema.graphql
/subgraph.yaml
```

---

## Build

```bash
# Generate AssemblyScript types from schema + ABIs
yarn graph:codegen   # or: ./node_modules/.bin/graph codegen

# Compile mappings to WASM
yarn graph:build     # or: ./node_modules/.bin/graph build
```

> If you see an event signature error, ensure the `event:` lines in `subgraph.yaml` match the ABI exactly (names, `indexed` flags, and argument order).

---

## Deploy to Subgraph Studio

1. Create a subgraph in Studio (slug suggestion: `ideation-market-graph-w3i`) and copy the Deploy Key.
2. Auth & deploy with the pinned CLI (no `--studio` flag needed in this version):

```bash
./node_modules/.bin/graph auth <YOUR_DEPLOY_KEY>
./node_modules/.bin/graph deploy ideation-market-graph-w3i
```

---

## Example queries

**Active listings by collection**
```graphql
query($c: Bytes!) {
  listings(
    where: { tokenAddress: $c, active: true }
    orderBy: createdAt
    orderDirection: desc
    first: 20
  ) {
    listingId
    tokenId
    tokenStandard
    priceTotal
    remainingQuantity
    listingType
    seller
    createdAt
  }
}
```

**Whitelist for one listing**
```graphql
query($listing: BigInt!) {
  whitelistedBuyers(
    where:{ listingId: $listing }
    first: 1000
  ) {
    buyer
    createdAt
  }
}
```

**All active listings for an NFT (721 or 1155)**
```graphql
query($c: Bytes!, $t: BigInt!) {
  listings(
    where: { tokenAddress: $c, tokenId: $t, active: true }
    orderBy: createdAt
    orderDirection: desc
    first: 100
  ) {
    listingId
    seller
    priceTotal
    remainingQuantity
  }
}
```

---

## Dev notes

- `feeRate` stored as `BigInt` (contract uses denominator `100_000`; values are small but we keep it future‑proof).
- `unitPrice` is set only when partial buys are enabled and `erc1155QuantityListed > 1`.
- Whitelist entries are **created** on `BuyerWhitelisted` and **deleted** on `BuyerRemovedFromWhitelist`.

---

## License

MIT — see [LICENSE](LICENSE).