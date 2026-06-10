#!/bin/sh
# Stampa il valore della env var MY_VAR (per i test): ignora stdin, exit 0.
printf '%s' "$MY_VAR"
