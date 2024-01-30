variable "profile" {
  type    = string
  default = "default"
}
variable "region-master" {
  type    = string
  default = "eu-west-2"
}

variable "region-worker" {
  type    = string
  default = "eu-west-1"
}

variable "external_ip" {
  type    = string
  default = "0.0.0.0/0"
}
variable "workers-count" {
  type    = number
  default = 1
}

variable "instance-type" {
  type    = string
  default = "t3.micro"
}

variable "webserver_port" {
  type    = number
  default = 8080
}
variable "dns_name" {
  type    = string
  default = "mk1micros.co.uk."
}
variable "ami" {
  type    = string
  default = "ami-02fb3e77af3bea031"

}