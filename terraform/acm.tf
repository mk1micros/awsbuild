# Fetch the Route 53 zone
data "aws_route53_zone" "main" {
  name = "mk1micros.co.uk."  # Replace with your domain name (must end with a dot)
}

resource "aws_acm_certificate" "mk1micros-lb-https" {
  domain_name       = "test.mk1micros.co.uk"  # Your custom domain
  validation_method = "DNS"
  tags = {
    Name = "MK1Micros-ACM"
  }
}

# DNS Validation Record for ACM
resource "aws_route53_record" "mk1micros_dns_validation" {
  depends_on = [aws_acm_certificate.mk1micros-lb-https]
  for_each = { for v in aws_acm_certificate.mk1micros-lb-https.domain_validation_options : v.resource_record_name => v }

  zone_id = data.aws_route53_zone.main.id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  ttl     = 60
  records = [each.value.resource_record_value]
}