#!/bin/sh
# Finto binario claude "lento" per testare l'abort: resta vivo ~2s, poi ecoa stdin.
sleep 2
exec cat
