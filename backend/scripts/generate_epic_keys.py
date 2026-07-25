#!/usr/bin/env python3
"""
Generate RSA Key Pair and JWKS for Epic OAuth 2.0 Integration.

Generates:
  1. backend/epic_private_key.pem (RSA Private Key - PEM)
  2. backend/epic_public_key.pem  (RSA Public Key - PEM)
  3. backend/epic_jwks.json        (JWKS containing public key parameters with RS384 alg)

Usage:
  python3 backend/scripts/generate_epic_keys.py [--kid KID] [--key-size 2048|4096] [--force]
"""

import argparse
import base64
import json
import os
import sys
import uuid
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def int_to_base64url(val: int) -> str:
    """Convert an integer to a base64url-encoded string without padding."""
    byte_length = (val.bit_length() + 7) // 8
    val_bytes = val.to_bytes(byte_length, byteorder="big")
    return base64.urlsafe_b64encode(val_bytes).rstrip(b"=").decode("ascii")


def generate_keys(out_dir: Path, kid: str, key_size: int, force: bool = False) -> None:
    private_key_path = out_dir / "epic_private_key.pem"
    public_key_path = out_dir / "epic_public_key.pem"
    jwks_path = out_dir / "epic_jwks.json"

    if not force and (private_key_path.exists() or public_key_path.exists() or jwks_path.exists()):
        existing = [str(p.name) for p in [private_key_path, public_key_path, jwks_path] if p.exists()]
        print(f"Warning: Existing key file(s) found in {out_dir}: {', '.join(existing)}")
        print("Use --force to overwrite existing key files.")
        sys.exit(1)

    print(f"Generating {key_size}-bit RSA key pair...")
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=key_size,
    )
    public_key = private_key.public_key()

    # Private key PEM (Traditional OpenSSL RSA format for compatibility with PyJWT)
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )

    # Public key PEM
    pem_public = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    # Convert public key components to JWK format (RS384 per Epic spec)
    public_numbers = public_key.public_numbers()
    jwk_data = {
        "keys": [
            {
                "kty": "RSA",
                "use": "sig",
                "alg": "RS384",
                "n": int_to_base64url(public_numbers.n),
                "e": int_to_base64url(public_numbers.e),
                "kid": kid,
            }
        ]
    }

    # Write private key
    with open(private_key_path, "wb") as f:
        f.write(pem_private)
    os.chmod(private_key_path, 0o600)

    # Write public key
    with open(public_key_path, "wb") as f:
        f.write(pem_public)

    # Write JWKS JSON
    with open(jwks_path, "w") as f:
        json.dump(jwk_data, f, indent=2)

    print(f"Successfully generated keys:")
    print(f"  - Private Key : {private_key_path}")
    print(f"  - Public Key  : {public_key_path}")
    print(f"  - JWKS JSON   : {jwks_path}")
    print(f"\nKey ID (kid): {kid}")
    print("\nReminder:")
    print("  - Host `epic_jwks.json` or paste its contents into your Epic Developer Portal app settings.")
    print("  - Ensure `EPIC_PRIVATE_KEY_PATH` in your .env points to `backend/epic_private_key.pem`.")


def main():
    parser = argparse.ArgumentParser(description="Generate Epic RSA key pair and JWKS file.")
    parser.add_argument(
        "--kid",
        type=str,
        default=f"epic-key-{uuid.uuid4().hex[:8]}",
        help="Key ID for the JWKS key entry",
    )
    parser.add_argument(
        "--key-size",
        type=int,
        choices=[2048, 4096],
        default=2048,
        help="RSA key size in bits (default: 2048)",
    )
    parser.add_argument(
        "-f", "--force",
        action="store_true",
        help="Force overwrite existing key files",
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default=None,
        help="Directory to save keys (default: backend directory)",
    )

    args = parser.parse_args()

    if args.out_dir:
        out_dir = Path(args.out_dir).resolve()
    else:
        # Default to repo root / backend
        script_dir = Path(__file__).resolve().parent
        out_dir = script_dir.parent

    generate_keys(out_dir=out_dir, kid=args.kid, key_size=args.key_size, force=args.force)


if __name__ == "__main__":
    main()
