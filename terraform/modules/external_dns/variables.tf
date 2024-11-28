variable "dns_record" {
    type = string

}

variable "dns_name" {
    type = string
  
}

variable "alb_dns_name" {
  type        = string
  description = "The DNS name of the Application Load Balancer"
}

variable "alb_zone_id" {
  type        = string
  description = "The zone ID of the Application Load Balancer"
}