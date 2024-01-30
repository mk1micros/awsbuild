data "aws_route53_zone" "dns" {
  name     = var.dns_name
}

# resource "aws_route53_record" "cert_record" {
#   provider = aws.region-master
#   for_each = {
#     for val in aws_acm_certificate.jenkins-lb-https.domain_validation_options : val.domain_name => {
#       name   = val.resource_record_name
#       record = val.resource_record_value
#       type   = val.resource_record_type
#     }
#   }
#   name    = each.value.name
#   records = [each.value.record]
#   ttl     = 60
#   type    = each.value.type
#   zone_id = data.aws_route53_zone.dns.zone_id
# }

resource "aws_route53_record" "dns_record" {
  zone_id  = data.aws_route53_zone.dns.zone_id
  name     = join(".", [var.dns_record, data.aws_route53_zone.dns.name])
  type     = "A"
  alias {
    name                   = var.aws_lb.application-lb.dns_name
    zone_id                = var.aws_lb.application-lb.zone_id
    evaluate_target_health = true
  }
}