{{- define "bestbudget.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "bestbudget.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "bestbudget.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "bestbudget.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "bestbudget.selectorLabels" -}}
app.kubernetes.io/name: {{ include "bestbudget.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "bestbudget.secretName" -}}
{{- default (include "bestbudget.fullname" .) .Values.existingSecret -}}
{{- end -}}

{{- define "bestbudget.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "bestbudget.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Value of a key in this release's existing Secret (base64-decoded), or "" — keeps generated secrets stable across upgrades.
Usage: include "bestbudget.existingValue" (list . "secret-name" "KEY")
*/}}
{{- define "bestbudget.existingValue" -}}
{{- $root := index . 0 -}}
{{- $secret := lookup "v1" "Secret" $root.Release.Namespace (index . 1) -}}
{{- if and $secret $secret.data (hasKey $secret.data (index . 2)) -}}
{{- index $secret.data (index . 2) | b64dec -}}
{{- end -}}
{{- end -}}

{{/* A configured value, else the value already stored in the cluster, else a new random one. */}}
{{- define "bestbudget.secretValue" -}}
{{- $root := index . 0 -}}
{{- $given := index . 3 -}}
{{- if $given -}}
{{- $given -}}
{{- else -}}
{{- $existing := include "bestbudget.existingValue" (list $root (index . 1) (index . 2)) -}}
{{- default (randAlphaNum (index . 4 | int)) $existing -}}
{{- end -}}
{{- end -}}

{{/*
The PostgreSQL password is needed in two Secrets (the database's and the app's DATABASE_URL).
Resolve it once per render and remember it, so a generated password is identical in both.
*/}}
{{- define "bestbudget.postgresql.password" -}}
{{- if not .Values.postgresql.password -}}
{{- $resolved := include "bestbudget.secretValue" (list . (include "bestbudget.postgresql.fullname" .) "POSTGRES_PASSWORD" "" 32) -}}
{{- $_ := set .Values.postgresql "password" $resolved -}}
{{- end -}}
{{- .Values.postgresql.password -}}
{{- end -}}

{{- define "bestbudget.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "postgres://%s:%s@%s:5432/%s" (.Values.postgresql.username | urlquery) (include "bestbudget.postgresql.password" . | urlquery) (include "bestbudget.postgresql.fullname" .) .Values.postgresql.database -}}
{{- else -}}
{{- required "externalDatabase.url is required when postgresql.enabled=false" .Values.externalDatabase.url -}}
{{- end -}}
{{- end -}}

{{- define "bestbudget.ingressHost" -}}
{{- default (urlParse .Values.appUrl).host .Values.ingress.host -}}
{{- end -}}
